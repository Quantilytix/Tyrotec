# Tyrotec Portal

Tyrotec Portal is a B2B ordering platform for industrial products. Customers can browse a catalogue, build quotes, place orders, pay by PayFast or manual bank transfer, and receive updates through the web portal, email, and WhatsApp. Staff manage inventory, customers, orders, payments, review queues, and reporting from the admin portal.

## Features

- Customer, sales-rep, and administrator accounts with Supabase Auth
- Product catalogue, search, stock levels, supplier details, and bulk import
- Quote builder with PDF generation
- Manual quote-to-order approval flow and fast PayFast checkout
- Atomic stock reservation, expiry, and warning jobs
- Manual EFT/bank-transfer proof submission and staff review
- PayFast ITN signature validation and server-to-server transaction validation
- In-app, email, and WhatsApp notifications
- WhatsApp product browsing, quotation, order, payment, and history flows
- Admin products, customers, staff, orders, payments, reviews, analytics, and activity logs

## Tech stack

| Area | Technology |
| --- | --- |
| Frontend | React 19, Vite, React Router, Tailwind CSS, Axios |
| Backend | Node.js, Express, Supabase JavaScript client |
| Database and authentication | Supabase / PostgreSQL / Supabase Auth |
| Payments | PayFast |
| Messaging | Meta WhatsApp Cloud API, Brevo email API (or Nodemailer/SMTP) |
| PDFs | jsPDF and jsPDF AutoTable |
| Product imports | Gemini structured-output API |
| Hosting | Render Static Site (frontend), Render Web Service (backend) |

## Project structure

```text
.
├── frontend/                 # React/Vite customer and admin portal
│   ├── src/pages/            # Customer-facing pages
│   ├── src/pages/admin/      # Staff and administrator pages
│   └── src/api/              # Backend API clients
├── backend/
│   ├── src/controllers/      # Express request handlers
│   ├── src/services/         # Payments, orders, notifications, WhatsApp
│   ├── src/jobs/             # Reservation warning/release jobs
│   └── sql/                  # Database bootstrap and legacy migrations
├── docs/                     # Operating and vendor setup documentation
└── render.yaml               # Render Blueprint: frontend and backend API
```

## Local development

### Prerequisites

- Node.js 20 or newer
- npm
- A Supabase project
- Optional: PayFast sandbox account, Brevo account (or SMTP provider), WhatsApp Cloud API account, and Gemini API key

### 1. Create the database

For a brand-new Supabase project, run [backend/sql/000_fresh_database_schema.sql](backend/sql/000_fresh_database_schema.sql) in the Supabase SQL Editor. It creates the complete empty schema, database functions, RLS policies, and storage buckets.

It does not copy data or create an administrator. After registering your first account, promote it in the SQL Editor:

```sql
update public.users
set role = 'admin', status = 'approved'
where email = 'your-admin-email@example.com';
```

### 2. Configure environment variables

Create `backend/.env` from `backend/.env.example` and add the values below. Never commit credentials.

```dotenv
PORT=5000
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
FRONTEND_URL=http://localhost:5173
BACKEND_URL=http://localhost:5000
CORS_ORIGINS=

EMAIL_FROM=Tyrotec <sales@tyrotec.co.za>
BREVO_API_KEY=
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=

PAYFAST_MODE=sandbox
PAYFAST_MERCHANT_ID=
PAYFAST_MERCHANT_KEY=
PAYFAST_PASSPHRASE=
PAYFAST_RETURN_URL=http://localhost:5173/orders
PAYFAST_CANCEL_URL=http://localhost:5173/orders

WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_APP_SECRET=
WHATSAPP_VERIFY_TOKEN=
GEMINI_API_KEY=

ADMIN_REVIEW_THRESHOLD=50000
RESERVATION_EXPIRY_MINUTES=60
RESERVATION_WARNING_LEAD_MINUTES=10
```

Create `frontend/.env` from `frontend/.env.example`:

```dotenv
VITE_API_URL=http://localhost:5000/api
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### 3. Install and start

Run these commands in separate terminals:

```bash
cd backend
npm install
npm run dev
```

```bash
cd frontend
npm install
npm run dev
```

The frontend runs at `http://localhost:5173`; the backend health endpoint is `http://localhost:5000/health`.

## Order and payment flow

Every order begins as a quote. Customers have two routes:

1. **Manual flow:** quote → `pending_approval` → staff approval → `approved` → manual payment review → fulfilment.
2. **Fast checkout:** quote → `stock_reserved` → verified PayFast payment → `confirmed` → `ready_for_collection`.

Fast checkout reserves stock atomically for a limited time. If payment is not completed, the reservation job restores stock and cancels the order. A browser redirect from PayFast never confirms payment by itself; only the verified PayFast ITN webhook can change an order to `confirmed`.

For the full state diagram and review-queue rules, see [docs/order-flow.md](docs/order-flow.md).

## Tests and quality checks

```bash
cd backend && npm test
cd frontend && npm test
cd frontend && npm run lint
cd frontend && npm run build
```

## Deployment

Everything runs on Render's Free plan. The root [render.yaml](render.yaml) is a Render Blueprint that creates both services:

| Service | Type | What it runs |
| --- | --- | --- |
| `tyrotec-portal` | Static site | Vite build of `frontend/`, served with an SPA rewrite |
| `tyrotec-api` | Free web service | `npm start` in `backend/`, health check `/health`, plus the reservation jobs every 5 minutes |

In the Render Dashboard choose **New → Blueprint** and select this repository. Render asks for every secret and URL marked `sync: false` in `render.yaml`; the backend values are described in [backend/.env.example](backend/.env.example) and the frontend values in [frontend/.env.example](frontend/.env.example). Non-secret backend settings (`PAYFAST_MODE`, review threshold, reservation timings) are set directly in `render.yaml`.

Services are reachable at `https://<service-name>.onrender.com` unless Render adds a suffix because the name is taken, so the URLs can be filled in while creating the Blueprint:

| Variable | Service | Value |
| --- | --- | --- |
| `VITE_API_URL` | `tyrotec-portal` | `https://tyrotec-api.onrender.com/api` |
| `BACKEND_URL` | `tyrotec-api` | `https://tyrotec-api.onrender.com` |
| `FRONTEND_URL`, `CORS_ORIGINS` | `tyrotec-api` | `https://tyrotec-portal.onrender.com` |
| `PAYFAST_RETURN_URL`, `PAYFAST_CANCEL_URL` | `tyrotec-api` | `https://tyrotec-portal.onrender.com/orders` |

- The API's region (`frankfurt`, nearest to the Supabase project in eu-west-1) can't be changed after it's created.
- `PAYFAST_PASSPHRASE` must exactly match the passphrase on the PayFast merchant account, or be empty if the account has none.
- `VITE_*` variables are compiled into the frontend build: redeploy `tyrotec-portal` after changing them. `VITE_SUPABASE_ANON_KEY` is the public anon key, never the service-role key.
- The static site rewrites every path to `index.html`, so refreshing deep links such as `/admin/payments` works.
- If a service ends up with a different URL, or a custom domain is added, update the variables above to match.
- On startup the API logs any expected environment variable that is missing.

### Free plan limitations

- **No cron jobs.** With `RUN_JOBS_IN_PROCESS=true` the API runs the reservation warning and release jobs itself every 5 minutes ([inProcessScheduler.js](backend/src/jobs/inProcessScheduler.js)). This is only safe while a single API instance runs.
- **Spin-down.** The API sleeps after 15 minutes without traffic and takes about a minute to wake; reservation jobs don't run while it sleeps and catch up when it wakes. A free uptime monitor requesting `/health` every 10 minutes keeps it awake, using roughly all of the workspace's 750 free instance hours a month.
- **No SMTP.** Render blocks outbound ports 25, 465, and 587 on free web services, so the API sends email through [Brevo](https://www.brevo.com)'s HTTPS API when `BREVO_API_KEY` is set. `EMAIL_FROM` must be a sender verified in Brevo; authenticate the sender's domain in Brevo (DNS records) so messages aren't marked as spam. Supabase sends its own Auth emails, such as password resets, separately.

### Upgrading from the Free plan

1. In `render.yaml`, change `tyrotec-api`'s `plan` from `free` to a paid instance type (e.g. `0.5c-512mb`) and `RUN_JOBS_IN_PROCESS` to `"false"`.
2. Add two cron jobs with the same Supabase, email (`BREVO_API_KEY`, `EMAIL_FROM`), and WhatsApp variables as the API:

   ```yaml
   - type: cron
     name: tyrotec-warn-expiring-reservations
     runtime: node
     region: frankfurt
     rootDir: backend
     schedule: "*/5 * * * *"
     buildCommand: npm ci --omit=dev
     startCommand: node src/jobs/warnExpiringReservations.js
   - type: cron
     name: tyrotec-release-expired-reservations
     runtime: node
     region: frankfurt
     rootDir: backend
     schedule: "1-59/5 * * * *"
     buildCommand: npm ci --omit=dev
     startCommand: node src/jobs/releaseExpiredReservations.js
   ```

Never run the in-process jobs and the cron jobs at the same time.

## Production checklist

- [ ] New Supabase schema has been created with `000_fresh_database_schema.sql`
- [ ] First administrator account has been promoted
- [ ] Supabase Auth redirect URLs include the deployed frontend URL
- [ ] Render Blueprint applied; `/health` responds and the API log shows the reservation jobs running
- [ ] Refreshing a deep link such as `/admin/payments` on the frontend loads the page
- [ ] Render backend has all required secrets, and `CORS_ORIGINS` is set
- [ ] PayFast uses live credentials, live URLs, and a verified notify endpoint
- [ ] Brevo sender `sales@tyrotec.co.za` is verified and the `tyrotec.co.za` domain is authenticated (DKIM/DMARC)
- [ ] WhatsApp webhook points to `/api/whatsapp/webhook`
- [ ] PayFast notify URL points to `/api/payments/payfast/notify`
- [ ] Reservation jobs run exactly once: in-process on the Free plan, or as cron jobs on a paid plan

## Additional documentation

- [Order and payment flow](docs/order-flow.md)
- [Tyrotec vendor requirements](docs/tyrotec-vendor-requirements.md)

## Security notes

- Do not expose Supabase service-role, PayFast, SMTP, WhatsApp, or Gemini keys in the frontend or commit them to Git.
- The backend uses the Supabase service role; browser API access is authenticated with a Supabase access token.
- PayFast order confirmation is deliberately restricted to a verified ITN callback rather than the customer browser redirect.

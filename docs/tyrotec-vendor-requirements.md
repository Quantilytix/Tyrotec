# Tyrotec Vendor Requirements Checklist

This document lists the production credentials and configuration details the Jamlea system needs from Tyrotec for live operation. The project is already wired to expect these values in its environment configuration and webhooks.

---

## 1) Supabase Requirements

The system uses Supabase for the database, authentication, and optionally storage and RLS-based access control.

Required from Tyrotec:

- Supabase project URL
  - Example format: `https://xxxxx.supabase.co`
- Supabase service role key
  - Used by the backend for privileged server-side access
- Supabase anonymous/public key
  - Used by the frontend for browser auth flows
- Supabase project name / environment name
- Supabase Auth settings
  - Email auth enabled
  - Google OAuth configuration if they intend to use Google sign-in
- Supabase storage bucket details if they want payment proofs or uploaded files stored there
- Database access and project ownership confirmation

Environment variables expected by this app:

Backend:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Frontend:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Notes:

- The backend uses the service-role key server-side.
- The frontend only uses the anon key for browser login flows.
- The app expects a real Supabase project, not a local database.

---

## 2) Render Requirements

The app is configured for deployment on Render and uses public URLs for backend/frontend communication and webhook callbacks.

Required from Tyrotec:

- Live backend deployment URL
  - Example: `https://jamlea-backend.onrender.com`
- Live frontend deployment URL
  - Example: `https://jamlea-frontend.onrender.com`
- Custom domain(s), if they want branding or business-specific domains
- Render service access / project access if they are managing deployment themselves
- Confirmation of where environment variables are stored in Render

Environment variables expected by the app:

Backend:

- `BACKEND_URL`
- `FRONTEND_URL`

These are used for:

- password reset links
- PayFast return/cancel URLs
- WhatsApp webhook and callback host configuration
- server-generated public links

Important webhook URLs the business must point to live Render hosts:

- WhatsApp webhook: `https://<backend-domain>/api/whatsapp/webhook`
- PayFast notify URL: `https://<backend-domain>/api/payments/payfast/notify`
- PayFast return URL: `https://<frontend-domain>/checkout/complete`
- PayFast cancel URL: `https://<frontend-domain>/checkout/cancelled`

---

## 3) WhatsApp Business API Requirements

The app uses Meta WhatsApp Cloud API for customer messaging and business notifications.

Required from Tyrotec:

- Meta Business Account access
- WhatsApp Business number connected to Meta
- WhatsApp Phone Number ID
- WhatsApp Access Token
- WhatsApp App Secret
- WhatsApp Verify Token
- Webhook subscription enabled for the backend URL
- Phone number approved for outgoing messages

Environment variables expected by the app:

- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_APP_SECRET`
- `WHATSAPP_VERIFY_TOKEN`

Webhook endpoint required:

- `https://<backend-domain>/api/whatsapp/webhook`

Webhook behavior expected:

- Verification on subscribe requests using `WHATSAPP_VERIFY_TOKEN`
- Signature validation using `WHATSAPP_APP_SECRET`
- Incoming WhatsApp message processing handled by the backend
- Outgoing customer and staff messaging through the WhatsApp Graph API

Notes:

- This system assumes a WhatsApp Cloud API setup, not a third-party WhatsApp gateway.
- The app also supports sending documents/images via Meta media upload endpoints.

---

## 4) Email / SMTP Requirements

The app sends notifications, password resets, customer updates, and internal staff emails via SMTP.

Required from Tyrotec:

- SMTP host
  - Example: Gmail SMTP, SendGrid, Mailgun, or their business mail provider
- SMTP port
- SMTP security mode
  - `true` for SSL/TLS secure connection or `false` depending on provider
- SMTP username
- SMTP password or app password
- Sender email address: `sales@tyrotec.co.za`
- Email domain ownership confirmation for SPF/DKIM setup if required
- Any business email account that can send transactional mail

Environment variables expected by the app:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

Notes:

- Set `SMTP_FROM=sales@tyrotec.co.za`. If it is not provided, the app falls back to `SMTP_USER`.
- This system sends operational emails like account and order notifications.
- A proper business email domain is strongly recommended for production reliability.

---

## 5) PayFast Requirements

This system integrates directly with PayFast for checkout and secure payment confirmation. The backend verifies transaction signatures and validates the ITN callback before changing order status.

Required from Tyrotec:

- Live PayFast merchant account access
- PayFast merchant ID
- PayFast merchant key
- PayFast passphrase
- Confirmation that the account is enabled for live transactions
- Production return URL
- Production cancel URL
- Production notify URL
- Domain approval / business setup confirmation with PayFast

Environment variables expected by the app:

- `PAYFAST_MODE` = `live` for production
- `PAYFAST_MERCHANT_ID`
- `PAYFAST_MERCHANT_KEY`
- `PAYFAST_PASSPHRASE`
- `PAYFAST_RETURN_URL`
- `PAYFAST_CANCEL_URL`

Required PayFast callback endpoints:

- Notify URL: `https://<backend-domain>/api/payments/payfast/notify`
- Return URL: `https://<frontend-domain>/checkout/complete`
- Cancel URL: `https://<frontend-domain>/checkout/cancelled`

Important notes:

- The app does not trust the browser redirect alone.
- It validates the PayFast ITN server-to-server before accepting payment status changes.
- The live merchant credentials must be used in production, not sandbox credentials.

---

## 6) Required Vendor Information to Send to Tyrotec

Please send Tyrotec this checklist in one message:

- Supabase project URL
- Supabase anon key
- Supabase service role key
- Render backend URL
- Render frontend URL
- WhatsApp Business Phone Number ID
- WhatsApp Access Token
- WhatsApp App Secret
- WhatsApp Verify Token
- SMTP host, port, user, password, sender email
- PayFast merchant ID
- PayFast merchant key
- PayFast passphrase
- PayFast live mode confirmation
- Business email domain used for system communications
- Final deployed domain names for backend and frontend

---

## 7) Production Setup Summary

For full live operation, the following must be working together:

- Supabase database + auth project
- Render-hosted backend frontend deployment
- Meta WhatsApp Cloud API connected to the business phone number
- Email SMTP provider configured for transactional emails
- PayFast live merchant account configured with correct callback URLs

Once Tyrotec provides these values, the environment variables can be entered into Render and the production app can be switched to live mode.

---

## 8) Quick Copy-and-Send Message

You can send this to Tyrotec:

> Please provide the live production credentials for the following services for the Jamlea system: Supabase project URL, Supabase anon key, Supabase service role key; Render backend URL and frontend URL; WhatsApp Business Phone Number ID, WhatsApp access token, WhatsApp app secret, and WhatsApp verify token; SMTP host, port, username, password, and sender email for business email; and PayFast merchant ID, merchant key, passphrase, and confirmation that the account is in live mode. We also need the production callback URLs for WhatsApp and PayFast, plus the business domain used for email and frontend deployment.


# QX connection

The portal feeds QX, Tyrotec's accounting system, and staff can open the portal from QX without a second password.

- **Data, portal → QX (one way):** customers, suppliers, products, quotes, orders, payments, purchases, stock adjustments and opening stock. QX turns committed orders into invoices, approved payments into receipts and purchases into supplier bills, and posts them to Tyrotec's books.
- **Sign-in, QX → portal:** staff click **Open Tyrotec Portal** in QX and land here signed in. **View in Tyrotec Portal** on a Tyrotec invoice, quote or customer in QX opens that order, quote or customer directly. This works only for approved staff accounts (admin, sales rep, super admin) whose email matches their QX login. Customers never sign in through QX.
  - The first sign-in from QX links the staff account to that QX user (`users.qx_user_id`). After that, only that QX user can open the account from QX, even if someone else's QX email is changed to match. If a staff member legitimately moves to a different QX login, a portal admin clears the link in the SQL Editor: `update public.users set qx_user_id = null where email = '<their email>';`

QX's side of the contract is documented in the QX repository (`quantnow/docs/CONNECTED_SYSTEMS_API.md`).

## How changes reach QX

1. Database triggers (`backend/sql/033_qx_sync_outbox.sql`) add a row to `qx_sync_outbox` whenever a record QX needs changes. The trigger runs in the same transaction as the change, so it catches changes from the API, the WhatsApp flows and the order/stock database functions alike. Repeated changes to one record collapse into one queued row.
2. About 15 seconds after any change made through the API, and every 5 minutes as a safety net, `services/qxSyncService.js` takes up to 200 due rows, rebuilds each record from its current data (`services/qxRecords.js`) and posts them to QX. Only one run happens at a time.
3. What QX accepted is marked sent. What it rejected is retried after 1, 2, 4 … minutes, at most 6 hours apart; the reason is in `qx_sync_outbox.last_error`. A rejection usually means a record it depends on hasn't arrived yet, e.g. a payment whose order hasn't been invoiced. When an order's status changes, its approved payments are queued again straight away (`034`), so they don't wait out a retry delay.

If QX is down, nothing is lost: the rows wait and go on a later run. Sent rows are kept for 30 days.

To see what's waiting and why:

```sql
select entity_type, entity_id, attempts, last_error, next_attempt_at
from public.qx_sync_outbox where sent_at is null order by id;
```

## Setting it up

Two stages. Sign-in can go live on its own; data is switched on later, once it's decided which history QX should receive.

### Stage 1: sign-in from QX (no data sent)

1. A QX platform admin creates the connection in QX:
   - QX company: Tyrotec's account (`info@tyrotec.co.za`)
   - Prefix: `TYR`
   - Portal URL: `https://portal.tyrotec.co.za`

   QX shows a key once.
2. Run `backend/sql/032_suppliers_purchases_stock.sql`, `033_qx_sync_outbox.sql` and `034_qx_sale_date_and_sign_in_link.sql`, in that order, in the Supabase SQL Editor. Changes start queuing for QX straight away, but nothing is sent.
3. In Render, set on `tyrotec-api`:
   - `QX_CONNECT_URL`: QX's API address followed by `/api/connect/v1`
   - `QX_CONNECT_KEY`: the key from step 1
   - `QX_SYNC_ENABLED`: `false`
4. In QX, on the connection's page, tick the staff who may open the portal. Each needs a portal staff account with the same email as their QX login.

QX's setup checklist will show the data items (payment accounts, "is sending data") as not done yet; that's expected until stage 2.

### Stage 2: sending data to QX

1. **Decide the cut-over.** If Tyrotec has been entering its sales, stock or customers in QX by hand, sending the portal's full history would count them twice. Agree a cut-over date first.
2. **Opening stock.**
   - Check the stock counts and fix any that are wrong with **Adjust stock** on the Products page.
   - Record **Opening stock** (admin menu).
   - From here on, stock comes in through **Purchases**.
3. Changes have been queuing since stage 1. Send only what was decided in step 1: clear the queue (`delete from public.qx_sync_outbox;`) and queue the history once:

   ```bash
   cd backend && node src/jobs/qxBackfill.js
   ```

   This queues everything; a cut-over date that leaves older orders out needs the backfill to take one (not built yet).
4. In Render, set `QX_SYNC_ENABLED` to `true`. The queue is sent 200 records at a time. Running the backfill again is harmless: QX skips what it already has.
5. In QX, on the connection's page, work through the setup checklist at the top, including which bank account each payment type posts to (PayFast, EFT, …).

On the Free plan the 5-minute run happens inside the API with the reservation jobs (`RUN_JOBS_IN_PROCESS=true`). On a paid plan, add a Render Cron Job running `node src/jobs/syncToQx.js` every 5 minutes, next to the reservation jobs. Either way, changes are also sent about 15 seconds after they're made.

## Rotating the key

A QX platform admin rotates the connection's key in QX. The old key stops working at once, so update `QX_CONNECT_KEY` in Render straight away. Queued changes wait and are sent once the new key is in place.

## Known limits

- **Changes reach QX about 15 seconds after they're made.** Every change goes through the API, which keeps a Free-plan service awake for at least 15 minutes, so new changes aren't held up by sleep. Only retries of rejected records wait for the API to be awake.
- **QX invoices are dated the day the order became a sale** (`orders.committed_at`, set when it's first approved, paid or confirmed), not the day it was placed.
- **QX never rewrites a posted invoice, payment or purchase on its own.** An order cancelled after its invoice was created, a reversed payment, or an edited purchase shows up in QX as a "needs attention" item. For orders and payments, QX's admin can **Reverse in QX** from there; purchases are corrected by hand. Cancelling an order in the portal also marks its payment `cancelled` (`036`), so QX never counts a cancelled order as paid.
- **Every call to Supabase gives up after 30 seconds** (`config/supabase.js`), so a stalled connection returns an error instead of leaving a request waiting for ever.
- **Average cost is kept to the cent.** Each sale or write-off is costed at the rounded average, so QX's Inventory account and the portal's stock value (quantity × average cost) can differ by a few cents. A small adjustment in QX clears it.

## Removing the connection

`backend/sql/rollback_qx_connection.sql` removes 034 and 033 (the queue, its triggers and the two new columns) and leaves 032, which the portal's stock and purchases depend on. To pause sending instead, set `QX_SYNC_ENABLED` to `false` in Render; sign-in from QX keeps working, and changes keep queuing until it's back on.

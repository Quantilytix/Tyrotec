# Manual test script: cancelled payments, waiting for stock, discounts

One walkthrough, start to finish. Each part uses what the part before it left
behind, so do them in order. Use the **test** database only
(`rvptzxmesbozanntfawd`), never the live one.

## 0. Setup (once)

**Accounts** (password `E2eTest!2026`):

| Account | Role |
|---|---|
| `e2e-admin@tyrotec.test` | Admin |
| `e2e-rep@tyrotec.test` | Sales rep |
| `e2e-c1@tyrotec.test` | Customer 1 |
| `e2e-c2@tyrotec.test` | Customer 2 |
| `e2e-c3@tyrotec.test` | Customer 3 (may pay on invoice) |

**Windows:** the admin in a normal browser window, customers in a private /
incognito window (sign out and in to switch customer).

**Start the portal**, two Git Bash windows:

```bash
# 1: backend (test database, QX/email/WhatsApp off)
cd "C:/Users/LEEROY/Desktop/QX Projects/JAMLEA Project/backend"
set -a; . ../../qx-local-lab/tyrotec-test.env; set +a
export QX_SYNC_ENABLED=false QX_CONNECT_URL= QX_CONNECT_KEY= \
  PORT=5000 FRONTEND_URL=http://localhost:5173 BACKEND_URL=http://localhost:5000 CORS_ORIGINS= \
  RUN_JOBS_IN_PROCESS=true PAYFAST_MODE=sandbox \
  BREVO_API_KEY= SMTP_HOST= SMTP_USER= SMTP_PASS= WHATSAPP_ACCESS_TOKEN= WHATSAPP_PHONE_NUMBER_ID=
node src/app.js
```
```bash
# 2: website
cd "C:/Users/LEEROY/Desktop/QX Projects/qx-local-lab" && ./lab.sh tyro-web
```

Open http://localhost:5173.

**Reset the test data** (Supabase SQL Editor of the test project). Cancels
the E2E accounts' open orders, ends all discounts, and sets the starting stock:

```sql
select public.cancel_order(o.id)
  from public.orders o join public.users u on u.id = o.customer_id
 where u.email like 'e2e-%' and o.status not in ('completed', 'cancelled', 'ready_for_collection');
```
```sql
-- Ends only discounts that cover nothing but the three E2E test products.
-- Any other discount (on real products) is left alone.
update public.discounts d set ended_at = now()
 where d.ended_at is null
   and not exists (select 1 from public.discount_products dp join public.products p on p.id = dp.product_id
                    where dp.discount_id = d.id and p.sku not in ('E2E-P1', 'E2E-P2', 'E2E-P3'));
update public.products set discount_id = null, discount_percent = null, discount_reason = null, discount_ends_on = null
 where sku in ('E2E-P1', 'E2E-P2', 'E2E-P3');
update public.products set stock_quantity = 0 where sku in ('E2E-P1', 'E2E-P3');
update public.products set stock_quantity = 5 where sku = 'E2E-P2';
```

The first query cancels **every** open order on the E2E accounts, including
ones you placed by hand. Skip it if you want to keep them.

Starting point: **E2E-P1** Waiting Valve (0 in stock, lead time 7),
**E2E-P2** Discount Pump (5 in stock, lead time 3), **E2E-P3** Special Order
Seal (0 in stock, lead time 0). All R1 000 excl. VAT.

**Limits on your computer:** email and WhatsApp are off (check the
**Notifications** page instead), and PayFast can't reach `localhost` to
confirm a payment, so use **Record payment** to mark orders paid.

---

## Part 1. Ordering something that's out of stock (Customer 1)

| # | Do | Expect |
|---|---|---|
| 1.1 | Products, search `E2E` | **Waiting Valve**: "Out of stock: usually delivered in about 7 days". **Special Order Seal** (lead time 0, from before it was required): also "about 7 days", never "ask us". **Add to quote** works on both. No "lead time" label on the in-stock **Discount Pump**. |
| 1.2 | On the **Discount Pump**, set quantity 8 | "Only 5 in stock: the rest usually take about 3 days". Set it back to 1. |
| 1.3 | Waiting Valve: quantity **2**, **Add to quote**, open **Quote builder** | The line shows the out-of-stock note, and a message says the order will wait for stock. |
| 1.4 | **Request quote** | The quote shows the note and "Some items aren't in stock right now. You can still accept…". **Accept & order** is there. |
| 1.5 | **Accept & order** | Order page: **Awaiting approval**, "Some items on this order aren't in stock yet. They usually take about 7 days…". **No Pay now** button. Note the order number (**Order A**). |

## Part 2. Telling the customer when it arrives (Admin)

| # | Do | Expect |
|---|---|---|
| 2.1 | **Review queue** | Order A is listed as stock short, at the **top** (newest first). **Newest first ⇅** switches to oldest first. |
| 2.2 | Open Order A (**Orders**) | **Waiting for stock** panel: "E2E Waiting Valve: needs 2, 0 in stock", "The customer has not been told…", box pre-filled with **7**. **No Approve order** button. |
| 2.3 | Change to **5**, **Tell the customer** | Panel: "Customer told to expect it around <today + 5>". |
| 2.4 | Customer 1: **Notifications**, then Order A | Notification "When your stock will arrive" with that date. Order A: "They're expected around <date>". |

## Part 3. Stock arrives, order approved by itself (Admin, then Customer 1)

| # | Do | Expect |
|---|---|---|
| 3.1 | **Purchases → Record a purchase**: any supplier, any invoice number, Waiting Valve × **2** | Saved. |
| 3.2 | Open Order A | **Awaiting payment**, "Payment due by <3 days from now>…". The panel is gone. |
| 3.3 | Admin **Notifications** | "Stock given to a waiting order". Review queue: Order A is gone. |
| 3.4 | Customer 1: Order A | **Pay now**, "Choose Pay now to pay with PayFast (card or Instant EFT). Please pay by <date>…". No mention of paying by EFT to the team. Notification "Your stock has arrived… Pay now on the Customer Portal with PayFast". |
| 3.5 | Admin: Products | Waiting Valve stock is **0** (the 2 went to Order A). |
| 3.6 | Admin: Order A → **Record payment** (cash, any reference) | Order A is **Paid**. |

## Part 4. Oldest order gets stock first (Customers 1 and 2, Admin)

| # | Do | Expect |
|---|---|---|
| 4.1 | Customer 1 orders **2** Waiting Valves (quote → accept): **Order B** | Awaiting approval. |
| 4.2 | Customer 2 orders **2** Waiting Valves: **Order C** | Awaiting approval. |
| 4.3 | Admin: Products → Waiting Valve → **Adjust stock +2** | **Order B** is now Awaiting payment. **Order C** still Awaiting approval. |
| 4.4 | **Adjust stock +2** again | **Order C** is now Awaiting payment. |

## Part 5. Not paid in time (Customer 2's Order C)

| # | Do | Expect |
|---|---|---|
| 5.1 | SQL: `update public.orders set payment_due_at = '2020-01-01' where order_number = <Order C>;` | Pretends the 3 days are up. |
| 5.2 | Wait up to **5 minutes** (the background job), refresh Order C | **Cancelled**. Waiting Valve stock goes up by 2. |
| 5.3 | Customer 2: **Notifications** | "Order cancelled: not paid in time". |

## Part 6. Cancelling a paid order (Admin, Order A)

| # | Do | Expect |
|---|---|---|
| 6.1 | Open Order A (paid in 3.6), click **Cancel order** | The confirmation says the payment will be marked cancelled (not paid) and to refund the customer separately. |
| 6.2 | Confirm | Badges **Cancelled** and **Payment Cancelled**. Stock goes up by 2. **Payments** page: that payment is no longer approved. |
| 6.3 | Customer 1: Order A | Same badges. |
| 6.4 | Admin: open **Order B** (unpaid), **Cancel order** | No payment warning in the confirmation. Cancelled, no payment badge. |

## Part 7. Paying on invoice after stock arrives (Customer 3)

| # | Do | Expect |
|---|---|---|
| 7.1 | Admin: check Waiting Valve stock (call it **S**). Customer 3 orders **S + 1** Waiting Valves: **Order D** | Awaiting approval (one short). |
| 7.2 | Admin: **Adjust stock +1** | Order D: Awaiting payment, with a pay-by date. |
| 7.3 | Customer 3: Order D | **Pay on invoice** and **Pay now** both shown. Click **Pay on invoice**. |
| 7.4 | — | "Placed on account". The pay-by date is gone. |

## Part 8. Discounts: setting one up (Admin, Sales rep)

| # | Do | Expect |
|---|---|---|
| 8.1 | Sales rep: look at the menu, then go to `/admin/discounts` | No **Discounts** item. The address sends them back to Products. |
| 8.2 | Admin: **Discounts → New discount**. Reason `Year-end clearance`, **15**%, no last day. Search `E2E-`, tick **Select all shown**, untick **Special Order Seal** | "2 selected". "For example … R 1 000,00 becomes R 850,00". |
| 8.3 | **Put 2 products on discount** | Listed: "15% off: Year-end clearance · Active until ended". Click "2 products": old → new prices. |
| 8.4 | **New discount** again, search `E2E-` | Pump and Valve are greyed out, "Already 15% off". **Cancel**. |
| 8.5 | Try saving a discount with 0%, then with a last day in the past | Both refused with a message. |

## Part 9. Discounts: what the customer sees (Customer 1)

| # | Do | Expect |
|---|---|---|
| 9.1 | Products | A green banner "🏷 2 products are on discount right now". The category drop-down has **no** "On discount" option. Click **View deals** | Only the Pump and the Valve. Green **R 850,00**, R 1 000,00 crossed out, "15% off: Year-end clearance". **Show all products** goes back. |
| 9.2 | Add **1 Discount Pump**, open Quote builder | "15% off: Year-end clearance · was R 1 000,00", line R 850,00. |
| 9.3 | **Request quote**, then **Download PDF** | Quote and PDF both show the discount and "was R 1 000,00". |
| 9.4 | **Accept & order**: **Order E** | Line R 850,00, total **R 977,50** incl. VAT, discount shown. **Pay now** with the reservation timer (it was in stock). |
| 9.5 | Add another Discount Pump, **Request quote**: **Quote F**. Don't accept it. | Quote F at R 850,00. |

## Part 10. Ending a discount (Admin, then Customer 1)

| # | Do | Expect |
|---|---|---|
| 10.1 | Admin: **Discounts → End now → End discount** | The discount shows as ended. |
| 10.2 | Customer 1: Products | The deals banner and **Deals only** button are gone. The Pump is back to R 1 000,00. |
| 10.3 | Open **Quote F** | "This discount has ended" on the line. No **Accept & order**. **Get an updated quote** button. |
| 10.4 | **Get an updated quote** | A new quote opens at **R 1 000,00**. Quote F now shows as expired. |
| 10.5 | Open **Order E** | Still R 850,00 / R 977,50: orders placed before the discount ended keep their price. |
| 10.6 | Admin: open Order E → **Record payment** with **977.50** | Paid. |

## Part 11. Recording a purchase with a new supplier and a new product (Admin)

| # | Do | Expect |
|---|---|---|
| 11a.1 | **Purchases → Record a purchase**, click **+ New supplier**, enter a name, **Add supplier** | The pop-up closes and the new supplier is selected. Nothing typed on the purchase is lost. |
| 11a.2 | On a line, type a product name that doesn't exist, e.g. `Test Gasket` | The list offers **+ Add "Test Gasket" as a new product**. Click it. |
| 11a.3 | Fill SKU, category, selling price; leave lead time 7. Quantity 3, unit cost 100. **Receive stock** | The purchase is saved. On Products, **Test Gasket** exists with 3 in stock, the new supplier, cost R 100. |
| 11a.4 | Try a product lead time of 0 on the product form | Refused: at least 1 day. |

## Part 12. Final checks (Admin)

| # | Do | Expect |
|---|---|---|
| 11.1 | **Activity log**, use **All actions** | Entries for: discount created, discount ended, arrival date set, quote refreshed, "Stock allocation (automated)", "Payment deadline (automated)". |
| 11.2 | Customer 1: order 1 Discount Pump normally | Reservation timer and **Pay now**, as before. |

If anything doesn't match, note the part and step number, what you saw, and
any message in the backend window.

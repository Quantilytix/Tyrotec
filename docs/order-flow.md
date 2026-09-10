# Order flow: manual approval + automated PayFast checkout

Tyrotec has two ways an order can move from "just placed" to "fulfilled" —
the original manual-approval flow, and a newer automated fast-checkout path
that sits alongside it. Both share the same `orders` table and the same
`orders.status` column; this document is the map of what each status means
and how an order can legally move between them.

**Everything that writes `orders.status` goes through one function**,
`transitionOrderStatus()` in `backend/src/services/orderStateService.js`
(for plain status moves) or one of the atomic stock-managing Postgres RPCs
(`approve_order`, `cancel_order`, `checkout_quote_with_reservation`,
`release_expired_reservations` — for moves that also touch product stock).
Nothing in the app updates `orders.status` any other way.

## The state machine

```
                    ┌─────────────────┐
                    │ pending_approval │◄──── quote converted (manual "Convert to order"),
                    └────────┬─────────┘      OR fast-checkout hit insufficient stock
                             │
                 admin approves (approve_order RPC:
                 atomically checks + decrements stock)
                             │
                             ▼
                       ┌───────────┐
                       │ approved  │───────► customer submits bank-transfer
                       └─────┬─────┘         proof, admin reviews it manually
                             │
                             ▼
                       ┌────────────┐
                       │ processing │
                       └─────┬──────┘
                             ▼
                       ┌───────────┐
                       │ completed │  (final)
                       └───────────┘

    ── fast-checkout path (customer clicks "Checkout now" on the quote,
       then "Pay with PayFast" on the resulting order) ──

                    ┌─────────────────┐
                    │  stock_reserved  │◄──── checkout_quote_with_reservation RPC:
                    └────────┬─────────┘      all lines had stock, reserved atomically
                             │
              verified PayFast ITN webhook only
             (never the browser return_url redirect)
                             │
                             ▼
                       ┌───────────┐
                       │ confirmed │
                       └─────┬─────┘
                             │  staff marks ready (admin dropdown)
                             ▼
                ┌───────────────────────┐
                │ ready_for_collection  │  (final)
                └────────────────────────┘

    cancelled -- reachable from any non-final state:
      * admin cancels manually (cancel_order RPC -- restocks if stock had
        been decremented, whether via approve_order or the reservation path)
      * a stock_reserved order's reservation expires unpaid
        (release_expired_reservations RPC, run on a schedule)
```

### Allowed transitions (`ORDER_TRANSITIONS`, `orderStateService.js`)

| From                    | To                                    |
| ----------------------- | -------------------------------------- |
| `pending_approval`      | `approved`, `cancelled`                |
| `approved`               | `processing`, `cancelled`              |
| `processing`             | `completed`, `cancelled`               |
| `stock_reserved`         | `confirmed`, `cancelled`               |
| `confirmed`              | `ready_for_collection`, `cancelled`    |
| `ready_for_collection`   | — (final)                              |
| `completed`              | — (final)                              |
| `cancelled`              | — (final)                              |

**`stock_reserved` and `confirmed` are never reachable from the admin status
dropdown.** `stock_reserved` is only ever set by
`checkout_quote_with_reservation`, and `confirmed` is only ever set by the
PayFast webhook after it independently re-validates the transaction with
PayFast's own servers — an admin clicking a button is exactly the kind of
untrusted client-side trigger payment confirmation is never allowed to come
from.

## Why two paths instead of one

Every order still ends up created by converting a quote (`orders.quote_id`
is always set) — there's no "create an order directly" path. What differs
is *when* stock is checked and who has to get involved:

- **Manual path** (`POST /quotes/:quoteId/convert`): order lands in
  `pending_approval` immediately, no stock touched yet. Stock is checked and
  decremented only when an admin approves it. Payment is a manual
  bank-transfer proof an admin reviews by hand.
- **Fast-checkout path** (`POST /quotes/:quoteId/checkout`): stock is
  checked and reserved (decremented) *immediately*, inside one atomic
  transaction (`checkout_quote_with_reservation`, using `for update` row
  locks so two concurrent checkouts on the same product can't both
  oversell). If every line has enough stock, the order skips
  `pending_approval` entirely and goes straight to `stock_reserved` with a
  60-minute (configurable) reservation clock running. This endpoint only
  creates the order — it never initiates payment itself. The customer lands
  on the order page and, as a separate explicit step, chooses to pay via
  PayFast (`POST /orders/:id/pay`) or submit a bank-transfer proof; the
  order confirms itself once the PayFast webhook verifies it, or an admin
  approves the manual proof — no admin involved at all in the PayFast
  common case.

## Admin review queue (`admin_reviews`)

Four independent triggers, checked at the relevant point in the flow. An
order can collect more than one review row (e.g. a stock-short order from a
brand-new customer gets both `stock_short` and, once resolved and later
converted, could still be flagged `new_customer` on top). Reviews never
block other customers' orders — the automated path proceeds normally for
`high_value`/`new_customer` orders; only `stock_short` genuinely can't
proceed automatically.

| Reason            | When it fires                                                                 | Resolve actions                                    |
| ------------------ | ------------------------------------------------------------------------------ | --------------------------------------------------- |
| `stock_short`      | Fast-checkout found at least one line without enough stock                     | `approve` (re-runs `approve_order`) / `reject` (`cancel_order`) |
| `manual_payment`    | Customer submitted a bank-transfer proof instead of paying via PayFast          | `approve` / `reject` (same review pipeline as the existing admin Payments page) |
| `high_value`        | `orders.total_amount > ADMIN_REVIEW_THRESHOLD` (env var, default R50,000)       | `acknowledge` (no order change) / `cancel`           |
| `new_customer`      | Customer has no prior order in `completed`/`confirmed`/`ready_for_collection`  | `acknowledge` / `cancel`                             |

Env vars: `ADMIN_REVIEW_THRESHOLD` (default `50000`),
`RESERVATION_EXPIRY_MINUTES` (default `60`),
`RESERVATION_WARNING_LEAD_MINUTES` (default `10`).

## Reservation expiry

`backend/src/jobs/releaseExpiredReservations.js` is a standalone script (not
an Express route), meant to run as a **Render Cron Job** on a schedule (e.g.
every 5 minutes) — deliberately not an in-process timer, which would
double-run once this app scales past one Render web instance. It calls
`release_expired_reservations()`, which restores stock, deletes the
reservation rows, and cancels the affected orders in one transaction; the
Node script then sends the "your reservation expired" notification per
order (plpgsql can't send emails/notifications itself).

`backend/src/jobs/warnExpiringReservations.js` is a second, separate Render
Cron Job (e.g. also every 5 minutes) that runs *before* the above -- it warns
a customer while their reservation still has a few minutes left, instead of
only telling them after the order's already been cancelled. It calls
`warn_expiring_reservations()` (`020_reservation_expiry_warning.sql`), which
atomically claims (via `orders.reservation_warned_at`) every `stock_reserved`
order whose reservation expires within `RESERVATION_WARNING_LEAD_MINUTES`
(default `10`) and hasn't been warned yet, so two overlapping runs can never
double-send. Kept as its own job rather than folded into the release job
above so either can change schedule or logic independently, and a bug in the
warning path can't affect the actual restock/cancel path.

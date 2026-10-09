-- Adds the 'cancelled' payment status, used when the order a payment belongs
-- to is cancelled (036_cancel_order_cancels_payments.sql).
--
-- RUN THIS FILE ON ITS OWN, AND FIRST. Postgres will not let a new enum
-- value be *used* in the same transaction that adds it, so 036 fails if the
-- two are pasted into the SQL Editor together. Same rule as 027.
--
-- Run order: 035 (this file), then 036.
--
-- Safe to run more than once.

alter type public.payment_status add value if not exists 'cancelled';

-- Verification: expects 'cancelled' in the list.
-- select unnest(enum_range(null::public.payment_status));

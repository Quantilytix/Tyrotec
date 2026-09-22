-- Adds the 'awaiting_payment' order status, used by the pay-on-invoice
-- ("order on account") route.
--
-- RUN THIS FILE ON ITS OWN, AND FIRST. Postgres will not let a new enum
-- value be *used* in the same transaction that adds it, so 028 -- which
-- writes 'awaiting_payment' inside a function body -- fails if the two are
-- pasted into the SQL Editor together. Same rule that applied to
-- 'super_admin' in 024.
--
-- Run order: 027 (this file), then 028.
--
-- Safe to run more than once.

alter type public.order_status add value if not exists 'awaiting_payment';

-- Verification: expects 'awaiting_payment' in the list.
-- select unnest(enum_range(null::public.order_status));

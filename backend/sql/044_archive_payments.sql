-- Archiving payments.
--
-- Staff can clear payments they no longer need to see -- practice payments,
-- typically -- off the Payments page. Only a cancelled or rejected payment
-- can be archived: it never counted as money received. Nothing is deleted,
-- so the payment stays on its order, in the activity log and in QX, and an
-- archived payment can be restored.
--
-- Run after 043. Safe to run more than once.

alter table public.payments add column if not exists archived_at timestamptz;

-- Verification:
-- select column_name from information_schema.columns
--  where table_schema = 'public' and table_name = 'payments' and column_name = 'archived_at';
-- (expects 1 row)

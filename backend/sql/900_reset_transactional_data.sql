-- Clears the trading data left over from testing, keeping the catalogue and
-- the accounts. Run once in the Supabase SQL Editor, before going live.
--
-- NOT a migration: the 0xx files build the schema and must be run in order.
-- This one is a tool, and it is DESTRUCTIVE and IRREVERSIBLE. Supabase's free
-- plan keeps no backups, so if any of this data matters, export it first
-- (Admin > Quotes / Orders > Export to Excel gives you a copy).
--
-- REMOVES: quotes, orders, payments, stock reservations, review-queue
--          entries, notifications, the audit log, WhatsApp conversations,
--          and outstanding staff invitations.
-- KEEPS:   products, product categories, and every user account (customers
--          and staff, with their roles and passwords intact).
--
-- Numbering restarts, so the first real quote is #1 and the first real order
-- is #1 rather than continuing from the test data.

begin;

-- Stock first, before the rows that explain it are gone.
--
-- Two statuses never owe anything back: 'pending_approval' never decremented
-- stock in the first place, and 'cancelled' already had it restored. Every
-- other status did take stock out of the catalogue -- 'approved' via
-- approve_order, 'stock_reserved' via checkout_quote_with_reservation, and
-- 'awaiting_payment' by inheriting a reservation that switch_order_to_invoice
-- released without restocking, plus everything downstream of those. Listing
-- the two exceptions rather than the many inclusions is what keeps this
-- correct as statuses get added.
--
-- Deleting the orders without this step would leave the catalogue
-- permanently short by whatever the test orders consumed.
update public.products p
set stock_quantity = p.stock_quantity + restore.quantity
from (
  select oi.product_id, sum(oi.quantity) as quantity
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where o.status not in ('pending_approval', 'cancelled')
  group by oi.product_id
) as restore
where p.id = restore.product_id;

-- Children before parents: these all reference orders or quotes.
delete from public.payments;
delete from public.stock_reservations;
delete from public.admin_reviews;
delete from public.order_items;
delete from public.orders;
delete from public.quote_items;
delete from public.quotes;

-- Test notifications and the audit trail of the testing itself.
-- Keeping the audit log instead is perfectly reasonable: comment out this
-- line if you would rather retain the history of who did what while setting
-- the system up.
delete from public.notifications;
delete from public.activity_log;

-- WhatsApp conversation state and the processed-message ledger. Clearing
-- these just means the next message from a number starts a fresh chat.
delete from public.whatsapp_conversations;
delete from public.whatsapp_processed_messages;

-- Outstanding staff invitations: any link already sent stops working, so
-- re-invite anyone who hasn't accepted yet. Accepted invites are gone too;
-- their accounts are untouched.
delete from public.staff_invites;

-- Start quote and order numbering from 1 for the real trading.
alter sequence public.quotes_quote_number_seq restart with 1;
alter sequence public.orders_order_number_seq restart with 1;

commit;

-- Verification: the first five should be 0, the last three unchanged
-- (784 products, 13 categories, and however many accounts you have -- 3 at
-- the time of writing).
-- select
--   (select count(*) from public.quotes) as quotes,
--   (select count(*) from public.orders) as orders,
--   (select count(*) from public.payments) as payments,
--   (select count(*) from public.notifications) as notifications,
--   (select count(*) from public.activity_log) as audit_entries,
--   (select count(*) from public.products) as products,
--   (select count(*) from public.product_categories) as categories,
--   (select count(*) from public.users) as accounts;

-- Stock check: every product the test orders touched should be back where it
-- started. If you ran the preview before the reset, compare against that.
-- select count(*) as products_at_zero from public.products where stock_quantity = 0;

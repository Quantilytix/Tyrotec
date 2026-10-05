-- Undoes the QX connection on the portal's side: 034 and 033. Run in the
-- Supabase SQL Editor only if the connection to QX is being removed, after
-- deploying portal code that no longer uses it.
--
-- To pause sending to QX instead, clear QX_CONNECT_URL / QX_CONNECT_KEY in
-- Render: nothing is sent, changes keep queuing, and they go once the
-- settings are back.
--
-- 032 (suppliers, purchases, stock adjustments, opening stock) is left in
-- place: it is how stock and costs are kept now, holds the purchase history,
-- and doesn't depend on QX.
--
-- Safe to run more than once.

begin;

-- 034 --------------------------------------------------------------------------
drop trigger if exists qx_outbox_order_payments on public.orders;
drop function if exists public.qx_enqueue_order_payments();
drop trigger if exists set_order_committed_at on public.orders;
drop function if exists public.set_order_committed_at();
alter table public.orders drop column if exists committed_at;
drop index if exists public.users_qx_user_id_key;
alter table public.users drop column if exists qx_user_id;

-- 033 --------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['users', 'suppliers', 'products', 'quotes', 'quote_items', 'orders', 'order_items',
                           'payments', 'purchases', 'purchase_items', 'stock_adjustments', 'opening_stock'] loop
    execute format('drop trigger if exists qx_outbox on public.%I', t);
  end loop;
end $$;
drop function if exists public.qx_outbox_trigger();
drop function if exists public.qx_enqueue_all();
drop function if exists public.qx_outbox_complete(jsonb);
drop function if exists public.qx_enqueue(text, uuid);
drop table if exists public.qx_sync_outbox;

commit;

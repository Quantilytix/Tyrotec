-- QX connection follow-ups. Run after 033_qx_sync_outbox.sql. Safe to run more
-- than once.
--
-- 1. orders.committed_at: when the order first became a sale (approved,
--    awaiting payment, confirmed, ...). QX dates the order's invoice on this
--    day, not the day the order was placed, so the sale falls in the month and
--    VAT period it was approved in.
-- 2. When an order's status changes, its approved payments are queued again,
--    so a payment approved before its order doesn't wait out a retry delay
--    once the order has been invoiced in QX.
-- 3. users.qx_user_id: the QX user a staff account signed in from QX as. The
--    first sign-in from QX links them; after that only that QX user can sign
--    in to this account from QX, even if someone gives another QX user the
--    same email.

-- 1. Sale date ------------------------------------------------------------------

alter table public.orders add column if not exists committed_at timestamptz;

create or replace function public.set_order_committed_at()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.committed_at is null and new.status::text in
     ('approved', 'awaiting_payment', 'confirmed', 'processing', 'completed', 'ready_for_collection') then
    new.committed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists set_order_committed_at on public.orders;
create trigger set_order_committed_at
  before insert or update of status on public.orders
  for each row execute function public.set_order_committed_at();

-- Orders already past approval: the first status change into a committed
-- status recorded in the activity log, else the day the order was placed.
-- The update queues them for QX (033's trigger); QX ignores the new date for
-- orders it has already invoiced.
update public.orders o
   set committed_at = coalesce(
     (select min(a.created_at) from public.activity_log a
       where a.entity_id = o.id and a.action = 'order.status_changed'
         and a.description ~ 'to "(approved|awaiting_payment|confirmed|processing|completed|ready_for_collection)"'),
     o.created_at)
 where o.committed_at is null
   and o.status::text in ('approved', 'awaiting_payment', 'confirmed', 'processing', 'completed', 'ready_for_collection');

-- 2. Payments follow their order --------------------------------------------------

create or replace function public.qx_enqueue_order_payments()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_payment uuid;
begin
  if new.status is distinct from old.status then
    for v_payment in select id from public.payments where order_id = new.id and status = 'approved' loop
      perform public.qx_enqueue('payment', v_payment);
    end loop;
  end if;
  return null;
end;
$$;

drop trigger if exists qx_outbox_order_payments on public.orders;
create trigger qx_outbox_order_payments
  after update of status on public.orders
  for each row execute function public.qx_enqueue_order_payments();

revoke execute on function public.qx_enqueue_order_payments() from public, anon, authenticated;

-- 3. QX sign-in link --------------------------------------------------------------

alter table public.users add column if not exists qx_user_id text;
create unique index if not exists users_qx_user_id_key on public.users (qx_user_id) where qx_user_id is not null;

-- Orders that wait for stock.
--
-- A customer can now quote and order a product that's out of stock. The
-- order waits in 'pending_approval' with a 'stock_short' review (as before),
-- and from here:
--
-- 1. Staff tell the customer when the stock should arrive
--    (orders.stock_expected_at, set through the API).
-- 2. When stock comes in -- a purchase, a stock adjustment, a cancelled order
--    or a lapsed reservation returning it -- waiting orders get it first,
--    oldest first, before anyone else can check out. An order is only
--    approved when every line can be supplied in full; one that can't keeps
--    waiting and doesn't hold stock back from newer orders that can be.
--    This runs at the end of the same transaction that added the stock
--    (a deferred trigger on products), so no checkout can slip in between.
-- 3. Approving a waiting order -- automatically or by staff -- gives the
--    customer 3 days to pay (orders.payment_due_at), online or by EFT. An
--    order still unpaid after that is cancelled
--    (cancel_overdue_unpaid_orders, run by the jobs), which returns its stock
--    to the next waiting order.
--
-- An approved order already has its stock set aside, so the customer can now
-- also pay it online (PayFast) or, for an account allowed to, switch it to
-- an invoice.
--
-- Run after 036. Safe to run more than once.

-- 1. Columns ----------------------------------------------------------------------

alter table public.orders add column if not exists stock_expected_at date;
alter table public.orders add column if not exists payment_due_at timestamptz;
-- Set when stock was allocated automatically; the API notifies the customer
-- and records allocation_notified_at.
alter table public.orders add column if not exists allocated_at timestamptz;
alter table public.orders add column if not exists allocation_notified_at timestamptz;

create index if not exists orders_allocation_unnotified_idx
  on public.orders (allocated_at) where allocated_at is not null and allocation_notified_at is null;
create index if not exists orders_payment_due_idx
  on public.orders (payment_due_at) where status = 'approved' and payment_due_at is not null;

-- 2. Approving -------------------------------------------------------------------

-- As 003, plus: approving an order that was waiting for stock resolves its
-- 'stock_short' review and starts the 3-day payment deadline. Orders approved
-- for any other reason (e.g. staff converting a quote with stock on hand)
-- keep no deadline, as before.
create or replace function public.approve_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status public.order_status;
  v_item record;
  v_was_waiting boolean;
begin
  select status into v_status from public.orders where id = p_order_id for update;
  if v_status is null then
    raise exception 'Order % not found', p_order_id;
  end if;
  if v_status <> 'pending_approval' then
    raise exception 'Order % is not pending approval (current status: %)', p_order_id, v_status;
  end if;

  for v_item in
    select oi.product_id, oi.quantity, p.stock_quantity, p.name
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    where oi.order_id = p_order_id
    for update of p
  loop
    if v_item.stock_quantity < v_item.quantity then
      raise exception 'Insufficient stock for product % (have %, need %)',
        v_item.name, v_item.stock_quantity, v_item.quantity;
    end if;
  end loop;

  update public.products p
  set stock_quantity = p.stock_quantity - oi.quantity
  from public.order_items oi
  where oi.order_id = p_order_id and oi.product_id = p.id;

  update public.admin_reviews set status = 'resolved', resolved_at = now()
   where order_id = p_order_id and reason = 'stock_short' and status = 'pending';
  v_was_waiting := found;

  update public.orders
     set status = 'approved',
         updated_at = now(),
         payment_due_at = case when v_was_waiting then now() + interval '3 days' else payment_due_at end
   where id = p_order_id;
end;
$$;

-- 3. Giving new stock to waiting orders ------------------------------------------

-- Approves every waiting order that can now be supplied in full, oldest
-- first. Returns the orders it approved. Never raises: one order that can't
-- be approved is skipped, so it can never undo the purchase or adjustment
-- that brought the stock in.
create or replace function public.allocate_stock_to_waiting_orders()
returns table (order_id uuid) language plpgsql security definer set search_path = public as $$
declare
  v_order_id uuid;
  v_allocated uuid[] := '{}';
begin
  for v_order_id in
    select o.id from public.orders o
     where o.status = 'pending_approval'
       and exists (select 1 from public.admin_reviews r
                    where r.order_id = o.id and r.reason = 'stock_short' and r.status = 'pending')
     order by o.created_at, o.id
  loop
    begin
      -- Re-checked under the lock: staff may have approved or cancelled it
      -- meanwhile.
      perform 1 from public.orders where id = v_order_id and status = 'pending_approval' for update;
      if not found then continue; end if;

      perform 1 from public.products p join public.order_items oi on oi.product_id = p.id
        where oi.order_id = v_order_id order by p.id for update of p;
      if exists (
        select 1 from public.order_items oi join public.products p on p.id = oi.product_id
         where oi.order_id = v_order_id
         group by oi.product_id, p.stock_quantity
        having p.stock_quantity < sum(oi.quantity)
      ) then
        continue;
      end if;

      perform public.approve_order(v_order_id);
      update public.orders set allocated_at = now(), allocation_notified_at = null where id = v_order_id;
      v_allocated := array_append(v_allocated, v_order_id);
    exception when others then
      raise warning 'Could not give stock to waiting order %: %', v_order_id, sqlerrm;
    end;
  end loop;
  return query select unnest(v_allocated);
end;
$$;

-- Runs the allocation at the end of any transaction that raised a product's
-- stock. Deferred, so a purchase of several products is allocated once all
-- its lines are in (oldest-first then sees the whole delivery), and so the
-- stock and its allocation become visible to other sessions together.
create or replace function public.allocate_stock_after_increase()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.allocate_stock_to_waiting_orders();
  return null;
end;
$$;

drop trigger if exists allocate_stock_after_increase on public.products;
create constraint trigger allocate_stock_after_increase
  after update of stock_quantity on public.products
  deferrable initially deferred
  for each row when (new.stock_quantity > old.stock_quantity)
  execute function public.allocate_stock_after_increase();

-- 4. Payment deadline ---------------------------------------------------------------

-- Cancels approved orders whose payment deadline has passed with no payment
-- recorded or pending. cancel_order returns their stock, which the trigger
-- above then offers to the next waiting order. Returns the cancelled orders.
create or replace function public.cancel_overdue_unpaid_orders()
returns table (order_id uuid) language plpgsql security definer set search_path = public as $$
declare
  v_order_id uuid;
  v_cancelled uuid[] := '{}';
begin
  for v_order_id in
    select o.id from public.orders o
     where o.status = 'approved' and o.payment_due_at < now()
     order by o.payment_due_at
  loop
    perform 1 from public.orders
      where id = v_order_id and status = 'approved' and payment_due_at < now() for update;
    if not found then continue; end if;
    if exists (select 1 from public.payments p
                where p.order_id = v_order_id and p.status in ('submitted', 'approved')) then
      continue;
    end if;
    perform public.cancel_order(v_order_id);
    v_cancelled := array_append(v_cancelled, v_order_id);
  end loop;
  return query select unnest(v_cancelled);
end;
$$;

-- 5. Paying an approved order on invoice ------------------------------------------

-- As 030, but an approved order (stock already set aside) can be switched
-- too. An invoice has its own terms, so the 3-day deadline no longer applies.
create or replace function public.switch_order_to_invoice(
  p_order_id uuid, p_customer_id uuid
) returns table (order_id uuid, order_status public.order_status)
language plpgsql security definer set search_path = public as $$
declare
  v_status public.order_status;
  v_owner uuid;
  v_on_account boolean;
begin
  select status, customer_id into v_status, v_owner
    from public.orders where id = p_order_id for update;
  if v_status is null then raise exception 'Order not found'; end if;
  if v_owner <> p_customer_id then raise exception 'Order not found'; end if;

  -- Re-checked here, not just in the API: this is the statement that lets
  -- goods leave without payment, so the permission belongs beside it.
  select can_order_on_account into v_on_account
    from public.users where id = p_customer_id;
  if not coalesce(v_on_account, false) then
    raise exception 'This account is not set up to pay on invoice';
  end if;

  if v_status not in ('stock_reserved', 'approved') then
    raise exception 'Only an order awaiting payment can be switched to an invoice (status: %)', v_status;
  end if;

  delete from public.stock_reservations where stock_reservations.order_id = p_order_id;
  update public.orders set status = 'awaiting_payment', payment_due_at = null, updated_at = now()
   where id = p_order_id;

  return query select p_order_id, 'awaiting_payment'::public.order_status;
end;
$$;

revoke execute on function public.approve_order(uuid) from public, anon, authenticated;
revoke execute on function public.allocate_stock_to_waiting_orders() from public, anon, authenticated;
revoke execute on function public.allocate_stock_after_increase() from public, anon, authenticated;
revoke execute on function public.cancel_overdue_unpaid_orders() from public, anon, authenticated;
revoke execute on function public.switch_order_to_invoice(uuid, uuid) from public, anon, authenticated;
grant execute on function public.approve_order(uuid) to service_role;
grant execute on function public.allocate_stock_to_waiting_orders() to service_role;
grant execute on function public.cancel_overdue_unpaid_orders() to service_role;
grant execute on function public.switch_order_to_invoice(uuid, uuid) to service_role;

-- Verification:
-- select column_name from information_schema.columns
--  where table_name = 'orders' and column_name in
--    ('stock_expected_at', 'payment_due_at', 'allocated_at', 'allocation_notified_at');
-- (expects 4 rows)
-- select tgname from pg_trigger where tgname = 'allocate_stock_after_increase';

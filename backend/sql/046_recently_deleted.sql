-- Recently deleted.
--
-- "Delete" on a quote, order/invoice, purchase or customer moves it to the
-- Recently deleted page for 30 days, where it can be restored. Nothing
-- financial is ever erased: a deleted order, invoice or purchase leaves the
-- portal's screens but stays in the database -- the books in QX, unbroken
-- invoice numbers and SARS's five-year record-keeping all rely on it. After
-- 30 days, deleted quotes and deleted customers with no orders are removed
-- for good (purge_recently_deleted, plus the API, which removes the
-- customer's sign-in).
--
-- What can be deleted:
-- - A quote no order was made from. (One that became an order goes with it.)
-- - An order/invoice that's cancelled, or still open -- it's cancelled first:
--   stock back, payments cancelled. Not a finished sale (completed, or ready
--   for collection).
-- - A purchase whose stock is still on the shelf. Deleting takes that stock
--   off again and backs its cost out of the products' average cost;
--   restoring puts both back.
-- - A customer with no orders/invoices left. Their sign-in is suspended and
--   their quotes go with them.
--
-- deleted_by has no foreign key on purpose: a second link from quotes/orders
-- to users would make the API's users(...) lookups ambiguous.
--
-- Run after 045. Safe to run more than once.

-- 1. Columns ----------------------------------------------------------------------

alter table public.quotes add column if not exists deleted_at timestamptz;
alter table public.quotes add column if not exists deleted_by uuid;
alter table public.orders add column if not exists deleted_at timestamptz;
alter table public.orders add column if not exists deleted_by uuid;
alter table public.purchases add column if not exists deleted_at timestamptz;
alter table public.purchases add column if not exists deleted_by uuid;
alter table public.users add column if not exists deleted_at timestamptz;
alter table public.users add column if not exists deleted_by uuid;

create index if not exists quotes_deleted_at_idx on public.quotes (deleted_at) where deleted_at is not null;
create index if not exists orders_deleted_at_idx on public.orders (deleted_at) where deleted_at is not null;
create index if not exists purchases_deleted_at_idx on public.purchases (deleted_at) where deleted_at is not null;
create index if not exists users_deleted_at_idx on public.users (deleted_at) where deleted_at is not null;

-- 2. Orders and invoices ------------------------------------------------------------

-- Returns the status it had, so the API can say whether it was cancelled first.
create or replace function public.delete_order(p_order_id uuid, p_deleted_by uuid)
returns public.order_status language plpgsql security definer set search_path = public as $$
declare
  v_status public.order_status;
  v_deleted_at timestamptz;
  v_quote_id uuid;
begin
  select status, deleted_at, quote_id into v_status, v_deleted_at, v_quote_id
    from public.orders where id = p_order_id for update;
  if v_status is null then
    raise exception 'Order % not found', p_order_id;
  end if;
  if v_deleted_at is not null then
    raise exception 'This is already in Recently deleted';
  end if;
  if v_status in ('completed', 'ready_for_collection') then
    raise exception 'A finished sale can''t be deleted: it is part of your books';
  end if;
  if v_status <> 'cancelled' then
    perform public.cancel_order(p_order_id);
  end if;

  update public.orders set deleted_at = now(), deleted_by = p_deleted_by where id = p_order_id;
  -- Its quote goes with it (cancelling reopened it, 031).
  update public.quotes set deleted_at = now(), deleted_by = p_deleted_by
   where id = v_quote_id and deleted_at is null;
  return v_status;
end;
$$;

-- Comes back cancelled: restoring never reopens a sale.
create or replace function public.restore_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_deleted_at timestamptz;
  v_quote_id uuid;
begin
  select deleted_at, quote_id into v_deleted_at, v_quote_id from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order % not found', p_order_id;
  end if;
  if v_deleted_at is null then
    raise exception 'This isn''t in Recently deleted';
  end if;
  update public.orders set deleted_at = null, deleted_by = null where id = p_order_id;
  update public.quotes set deleted_at = null, deleted_by = null where id = v_quote_id and deleted_at = v_deleted_at;
end;
$$;

-- 3. Purchases -----------------------------------------------------------------------

create or replace function public.delete_purchase(p_purchase_id uuid, p_deleted_by uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_deleted_at timestamptz;
  v_item record;
begin
  select deleted_at into v_deleted_at from public.purchases where id = p_purchase_id for update;
  if not found then
    raise exception 'Purchase % not found', p_purchase_id;
  end if;
  if v_deleted_at is not null then
    raise exception 'This is already in Recently deleted';
  end if;

  perform 1 from public.products
   where id in (select product_id from public.purchase_items where purchase_id = p_purchase_id)
   order by id for update;

  for v_item in
    select pi.product_id, p.name, p.stock_quantity, p.supplier_cost,
           sum(pi.quantity)::integer as qty, sum(pi.quantity * pi.unit_cost) as value
      from public.purchase_items pi join public.products p on p.id = pi.product_id
     where pi.purchase_id = p_purchase_id
     group by pi.product_id, p.name, p.stock_quantity, p.supplier_cost
  loop
    if v_item.stock_quantity < v_item.qty then
      raise exception 'Only % of the % % from this purchase are still in stock, so it can''t be deleted. Correct the stock instead.',
        v_item.stock_quantity, v_item.qty, v_item.name;
    end if;
    -- The weighted average cost with this purchase taken back out (032 put
    -- it in). Nothing left on the shelf: the cost stays as it was.
    update public.products
       set supplier_cost = case
             when stock_quantity > v_item.qty and supplier_cost is not null
               then greatest(round((stock_quantity * supplier_cost - v_item.value) / (stock_quantity - v_item.qty), 2), 0)
             else supplier_cost
           end,
           stock_quantity = stock_quantity - v_item.qty,
           updated_at = now()
     where id = v_item.product_id;
  end loop;

  update public.purchases set deleted_at = now(), deleted_by = p_deleted_by where id = p_purchase_id;
end;
$$;

-- Puts the stock and its cost back, exactly as receiving it did (032). Stock
-- that goes up is offered to waiting orders (037's trigger).
create or replace function public.restore_purchase(p_purchase_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_deleted_at timestamptz;
  v_item record;
begin
  select deleted_at into v_deleted_at from public.purchases where id = p_purchase_id for update;
  if not found then
    raise exception 'Purchase % not found', p_purchase_id;
  end if;
  if v_deleted_at is null then
    raise exception 'This isn''t in Recently deleted';
  end if;

  perform 1 from public.products
   where id in (select product_id from public.purchase_items where purchase_id = p_purchase_id)
   order by id for update;

  for v_item in
    select product_id, sum(quantity)::integer as qty, sum(quantity * unit_cost) as value
      from public.purchase_items where purchase_id = p_purchase_id group by product_id
  loop
    update public.products
       set supplier_cost = case
             when stock_quantity > 0 and supplier_cost is not null
               then round((stock_quantity * supplier_cost + v_item.value) / (stock_quantity + v_item.qty), 2)
             else round(v_item.value / v_item.qty, 2)
           end,
           stock_quantity = stock_quantity + v_item.qty,
           updated_at = now()
     where id = v_item.product_id;
  end loop;

  update public.purchases set deleted_at = null, deleted_by = null where id = p_purchase_id;
end;
$$;

-- 4. Customers -----------------------------------------------------------------------

create or replace function public.delete_customer(p_customer_id uuid, p_deleted_by uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_role public.user_role;
  v_deleted_at timestamptz;
  v_orders integer;
begin
  select role, deleted_at into v_role, v_deleted_at from public.users where id = p_customer_id for update;
  if v_role is distinct from 'customer' then
    raise exception 'Customer % not found', p_customer_id;
  end if;
  if v_deleted_at is not null then
    raise exception 'This is already in Recently deleted';
  end if;
  select count(*) into v_orders from public.orders where customer_id = p_customer_id and deleted_at is null;
  if v_orders > 0 then
    raise exception 'This customer still has % order(s) or invoice(s). Delete those first.', v_orders;
  end if;

  update public.users set deleted_at = now(), deleted_by = p_deleted_by, status = 'suspended' where id = p_customer_id;
  update public.quotes q set deleted_at = now(), deleted_by = p_deleted_by
   where q.customer_id = p_customer_id and q.deleted_at is null
     and not exists (select 1 from public.orders o where o.quote_id = q.id);
end;
$$;

create or replace function public.restore_customer(p_customer_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_deleted_at timestamptz;
begin
  select deleted_at into v_deleted_at from public.users where id = p_customer_id and role = 'customer' for update;
  if not found then
    raise exception 'Customer % not found', p_customer_id;
  end if;
  if v_deleted_at is null then
    raise exception 'This isn''t in Recently deleted';
  end if;
  update public.users set deleted_at = null, deleted_by = null, status = 'approved' where id = p_customer_id;
  update public.quotes set deleted_at = null, deleted_by = null
   where customer_id = p_customer_id and deleted_at = v_deleted_at;
end;
$$;

-- 5. After 30 days ---------------------------------------------------------------------

-- Removes deleted quotes for good, and returns the deleted customers now due
-- to go (no orders at all), whose sign-in the API removes -- which takes
-- their profile with it. Orders, invoices and purchases are never removed.
create or replace function public.purge_recently_deleted()
returns table (purged_customer_id uuid) language plpgsql security definer set search_path = public as $$
begin
  delete from public.quotes q
   where q.deleted_at < now() - interval '30 days'
     and not exists (select 1 from public.orders o where o.quote_id = q.id);
  return query
    select u.id from public.users u
     where u.role = 'customer' and u.deleted_at < now() - interval '30 days'
       and not exists (select 1 from public.orders o where o.customer_id = u.id);
end;
$$;

revoke execute on function public.delete_order(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.restore_order(uuid) from public, anon, authenticated;
revoke execute on function public.delete_purchase(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.restore_purchase(uuid) from public, anon, authenticated;
revoke execute on function public.delete_customer(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.restore_customer(uuid) from public, anon, authenticated;
revoke execute on function public.purge_recently_deleted() from public, anon, authenticated;
grant execute on function public.delete_order(uuid, uuid) to service_role;
grant execute on function public.restore_order(uuid) to service_role;
grant execute on function public.delete_purchase(uuid, uuid) to service_role;
grant execute on function public.restore_purchase(uuid) to service_role;
grant execute on function public.delete_customer(uuid, uuid) to service_role;
grant execute on function public.restore_customer(uuid) to service_role;
grant execute on function public.purge_recently_deleted() to service_role;

-- Verification:
-- select count(*) from information_schema.columns
--  where table_schema = 'public' and column_name = 'deleted_at'
--    and table_name in ('quotes', 'orders', 'purchases', 'users');  -- 4

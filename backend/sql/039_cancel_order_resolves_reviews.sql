-- Cancelling an order closes its review-queue items.
--
-- cancel_order() and the reservation-expiry job cancelled the order but left
-- its admin_reviews rows 'pending', so the Review queue kept listing
-- cancelled orders with "Approve anyway" / "Acknowledge" buttons that could
-- only fail or do nothing. Now cancelling resolves them in the same
-- transaction, and the ones already left behind are resolved below.
--
-- Same functions as 036, plus the admin_reviews update. Run after 038.
-- Safe to run more than once.

create or replace function public.cancel_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_status public.order_status; v_quote_id uuid;
begin
  select status, quote_id into v_status, v_quote_id
    from public.orders where id = p_order_id for update;
  if v_status is null then raise exception 'Order % not found', p_order_id; end if;
  if v_status in ('completed', 'cancelled', 'ready_for_collection') then
    raise exception 'Order % cannot be cancelled from status %', p_order_id, v_status;
  end if;
  -- 'pending_approval' never decremented stock, so there is nothing to put
  -- back for it.
  if v_status <> 'pending_approval' then
    update public.products p set stock_quantity = p.stock_quantity + oi.quantity
      from public.order_items oi where oi.order_id = p_order_id and oi.product_id = p.id;
  end if;
  delete from public.stock_reservations where stock_reservations.order_id = p_order_id;
  update public.payments set status = 'cancelled'
    where order_id = p_order_id and status in ('submitted', 'approved');
  update public.admin_reviews set status = 'resolved', resolved_at = now()
    where order_id = p_order_id and status = 'pending';
  update public.orders set status = 'cancelled' where id = p_order_id;

  -- Only reopen a quote that is still 'converted' -- never resurrect one a
  -- person deliberately expired.
  if v_quote_id is not null then
    update public.quotes set status = 'submitted'
      where id = v_quote_id and status = 'converted';
  end if;
end;
$$;

create or replace function public.release_expired_reservations()
returns table (order_id uuid) language plpgsql security definer set search_path = public as $$
declare v_order_id uuid; v_quote_id uuid; v_released uuid[] := '{}';
begin
  for v_order_id in
    select distinct sr.order_id from public.stock_reservations sr join public.orders o on o.id = sr.order_id
      where sr.expires_at < now() and o.status = 'stock_reserved'
  loop
    perform 1 from public.orders where id = v_order_id for update;
    update public.products p set stock_quantity = p.stock_quantity + sr.quantity
      from public.stock_reservations sr where sr.order_id = v_order_id and sr.product_id = p.id;
    delete from public.stock_reservations where stock_reservations.order_id = v_order_id;
    update public.payments set status = 'cancelled'
      where payments.order_id = v_order_id and status in ('submitted', 'approved');
    update public.admin_reviews set status = 'resolved', resolved_at = now()
      where admin_reviews.order_id = v_order_id and status = 'pending';
    update public.orders set status = 'cancelled' where id = v_order_id
      returning quote_id into v_quote_id;

    if v_quote_id is not null then
      update public.quotes set status = 'submitted'
        where id = v_quote_id and status = 'converted';
    end if;

    v_released := array_append(v_released, v_order_id);
  end loop;
  return query select unnest(v_released);
end;
$$;

revoke execute on function public.cancel_order(uuid) from public, anon, authenticated;
revoke execute on function public.release_expired_reservations() from public, anon, authenticated;
grant execute on function public.cancel_order(uuid) to service_role;
grant execute on function public.release_expired_reservations() to service_role;

-- Items already left behind by orders that are finished.
update public.admin_reviews r
   set status = 'resolved', resolved_at = now()
  from public.orders o
 where o.id = r.order_id
   and r.status = 'pending'
   and o.status in ('cancelled', 'completed', 'ready_for_collection');

-- Verification: expects 0.
-- select count(*) from public.admin_reviews r join public.orders o on o.id = r.order_id
--  where r.status = 'pending' and o.status in ('cancelled', 'completed', 'ready_for_collection');

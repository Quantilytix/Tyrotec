-- Cancelling an order cancels its payments too.
--
-- An order can be cancelled after it was paid ('confirmed', 'processing').
-- cancel_order() set the order to 'cancelled' but left its payment
-- 'approved', so the cancelled order still read as paid: "Payment approved"
-- on the order pages and the Payments list, and -- because an order's status
-- change re-sends its approved payments (034) -- an approved payment in QX,
-- which records it as money received against the invoice.
--
-- Now the order's submitted/approved payments become 'cancelled' in the same
-- transaction. QX records only approved payments, so it flags the change for
-- "Reverse in QX" instead of counting the order as paid. Refunding the
-- customer stays a manual step.
--
-- A PayFast payment that arrives *after* an order was cancelled is still
-- recorded as approved: that is real money that needs refunding, and QX flags
-- it as a payment on a cancelled order.
--
-- Run 035_payment_status_cancelled.sql first, on its own.
--
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
  update public.orders set status = 'cancelled' where id = p_order_id;

  -- Only reopen a quote that is still 'converted' -- never resurrect one a
  -- person deliberately expired.
  if v_quote_id is not null then
    update public.quotes set status = 'submitted'
      where id = v_quote_id and status = 'converted';
  end if;
end;
$$;

-- The expiry job cancels orders directly rather than calling cancel_order(),
-- so it needs the same treatment. Its orders are still 'stock_reserved' (a
-- completed PayFast payment moves them on), so this only catches a pending
-- 'submitted' one.
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

-- Orders cancelled before this fix still have payments marked approved. List
-- them first: a payment that arrived after its order was cancelled is real
-- money (see above) and should stay approved until the customer is refunded.
--
-- select o.order_number, o.updated_at as order_changed, p.reference, p.amount, p.status, p.created_at as paid
--   from public.payments p join public.orders o on o.id = p.order_id
--  where o.status = 'cancelled' and p.status in ('submitted', 'approved')
--  order by o.order_number;
--
-- Then cancel the ones that should be (this also sends them to QX, which
-- flags each for "Reverse in QX"):
--
-- update public.payments set status = 'cancelled'
--  where status in ('submitted', 'approved')
--    and order_id in (select id from public.orders where status = 'cancelled' and order_number in (/* numbers */));

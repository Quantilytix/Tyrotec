-- Stock received for an order waiting for it.
--
-- An order or invoice waiting for stock can now be told its stock has
-- arrived, from its own page: staff record the supplier's delivery (a
-- purchase, exactly as on the Purchases page) and the order takes that stock
-- straight away. Doing both in one transaction means the order gets the
-- stock bought for it, rather than whichever order has waited longest for the
-- same product (037's rule for stock that isn't earmarked). If the delivery
-- doesn't cover every line, nothing is recorded.
--
-- The order is marked as allocated, as 037's automatic allocation does, so
-- the API tells the customer the same way: pay by the deadline or, if it was
-- paid while it waited (043), that it's already paid and being got ready.
--
-- Run after 044. Safe to run more than once.

create or replace function public.receive_stock_for_order(
  p_order_id uuid, p_supplier_id uuid, p_supplier_invoice_number text, p_purchase_date date,
  p_due_date date, p_notes text, p_lines jsonb, p_received_by uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_status public.order_status;
  v_purchase_id uuid;
begin
  select status into v_status from public.orders where id = p_order_id for update;
  if v_status is null then
    raise exception 'Order % not found', p_order_id;
  end if;
  if v_status <> 'pending_approval' then
    raise exception 'This order is no longer waiting for stock';
  end if;

  v_purchase_id := public.receive_purchase(
    p_supplier_id, p_supplier_invoice_number, p_purchase_date, p_due_date, p_notes, p_lines, p_received_by
  );
  -- Raises (undoing the purchase too) if the delivery doesn't cover the order.
  perform public.approve_order(p_order_id);
  update public.orders set allocated_at = now(), allocation_notified_at = null where id = p_order_id;
  return v_purchase_id;
end;
$$;

revoke execute on function public.receive_stock_for_order(uuid, uuid, text, date, date, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.receive_stock_for_order(uuid, uuid, text, date, date, text, jsonb, uuid) to service_role;

-- Verification:
-- select proname from pg_proc where proname = 'receive_stock_for_order';  -- 1 row

-- Paying an order before it's approved.
--
-- Customers sometimes pay before their order is approved -- typically an
-- order waiting for stock, paid up front so Tyrotec can buy the stock in.
-- Staff can now record that payment straight away (paymentService.js): if
-- the stock is there, the order is approved and paid in one go; if not, it
-- keeps waiting for stock, already paid.
--
-- approve_order now checks for that payment. An order that's already paid
-- goes straight to 'confirmed' when it's approved -- automatically when its
-- stock arrives, or by staff -- with no 3-day payment deadline, so the
-- customer is never asked to pay again and the order can't be cancelled as
-- unpaid.
--
-- Run after 042. Safe to run more than once.

-- As 037, plus the paid check at the end.
create or replace function public.approve_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status public.order_status;
  v_item record;
  v_was_waiting boolean;
  v_paid boolean;
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

  v_paid := exists (select 1 from public.payments where order_id = p_order_id and status = 'approved');

  update public.orders
     set status = case when v_paid then 'confirmed'::public.order_status else 'approved'::public.order_status end,
         updated_at = now(),
         payment_due_at = case
           when v_paid then null
           when v_was_waiting then now() + interval '3 days'
           else payment_due_at
         end
   where id = p_order_id;
end;
$$;

revoke execute on function public.approve_order(uuid) from public, anon, authenticated;
grant execute on function public.approve_order(uuid) to service_role;

-- Verification:
-- select prosrc like '%v_paid%' from pg_proc where proname = 'approve_order';
-- (expects true)

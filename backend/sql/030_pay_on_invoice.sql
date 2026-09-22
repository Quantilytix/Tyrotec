-- Moves the "order on account" choice off the quote page and onto the order.
--
-- 028 let an approved customer take a *separate* route from the quote, which
-- meant two buttons doing almost the same thing and a customer having to
-- understand the difference before they had even placed the order. Now every
-- customer takes one route -- accept the quote, get an order -- and only
-- then, on the order itself, an approved customer may choose to be invoiced
-- instead of paying online.
--
-- Run after 027 and 028.
-- Safe to run more than once.

-- Superseded by switch_order_to_invoice below. Dropping it rather than
-- leaving it in place: it is an unreferenced SECURITY DEFINER function that
-- commits stock without taking payment, which is not something to leave
-- lying around.
drop function if exists public.checkout_quote_on_account(uuid, uuid);

-- Turns a reserved, unpaid order into one payable on invoice.
--
-- The reservation rows are deleted but the stock is deliberately NOT
-- restored: the goods stay committed to this customer. Dropping the rows is
-- what frees the order from release_expired_reservations(), which finds its
-- work by joining stock_reservations to orders -- an invoice a customer has
-- 30 days to pay must not be cancelled by a timer an hour later.
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

  if v_status <> 'stock_reserved' then
    raise exception 'Only an order awaiting payment can be switched to an invoice (status: %)', v_status;
  end if;

  delete from public.stock_reservations where stock_reservations.order_id = p_order_id;
  update public.orders set status = 'awaiting_payment', updated_at = now() where id = p_order_id;

  return query select p_order_id, 'awaiting_payment'::public.order_status;
end;
$$;

revoke execute on function public.switch_order_to_invoice(uuid, uuid) from public, anon, authenticated;
grant execute on function public.switch_order_to_invoice(uuid, uuid) to service_role;

-- Verification:
-- select proname from pg_proc where proname in ('switch_order_to_invoice', 'checkout_quote_on_account');
-- (expects one row: switch_order_to_invoice)

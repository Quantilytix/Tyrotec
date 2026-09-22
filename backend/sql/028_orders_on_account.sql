-- Pay-on-invoice ordering ("order on account") for approved trade customers.
--
-- RUN 027 FIRST, ON ITS OWN -- this file uses the 'awaiting_payment' enum
-- value that 027 adds, and Postgres refuses to use a new enum value in the
-- transaction that created it.
--
-- The customer accepts their quote, the order is created immediately and the
-- stock is committed to them, and payment follows on invoice instead of
-- gating the order. Only customers a staff member has explicitly flagged can
-- do this; everyone else keeps paying through PayFast up front.
--
-- Safe to run more than once.

-- Off for everyone until an admin turns it on for a specific customer, so
-- applying this migration changes nothing on its own.
alter table public.users
  add column if not exists can_order_on_account boolean not null default false;

comment on column public.users.can_order_on_account is
  'Customer may place orders payable on invoice, without paying up front.';

-- Sibling of checkout_quote_with_reservation(): identical, minus the
-- stock_reservations insert, and landing in 'awaiting_payment' instead of
-- 'stock_reserved'.
--
-- That missing reservation row is the entire point. release_expired_
-- reservations() finds work by joining stock_reservations to orders, so an
-- order with no reservation row can never be auto-cancelled -- which is
-- exactly right for an invoice a customer has 30 days to pay. The stock is
-- still decremented, so the goods are genuinely committed; releasing them
-- again is a staff decision (cancel the order), not a timer.
--
-- Stock shortfall behaves the same as the reservation path: the order is
-- created in 'pending_approval' and the caller flags it for review, rather
-- than failing the checkout outright.
create or replace function public.checkout_quote_on_account(
  p_quote_id uuid, p_customer_id uuid
) returns table (order_id uuid, order_status public.order_status, short_product_id uuid, short_requested integer, short_available integer)
language plpgsql security definer set search_path = public as $$
declare
  v_quote_status public.quote_status; v_total_amount numeric; v_order_id uuid;
  v_subtotal_amount numeric; v_vat_amount numeric;
  v_on_account boolean;
  v_short_product_id uuid; v_short_requested integer; v_short_available integer;
begin
  -- Re-checked here, not just in the API: this is the function that commits
  -- stock without taking money, so the permission belongs on the same
  -- transaction that acts on it.
  select can_order_on_account into v_on_account
    from public.users where id = p_customer_id;
  if not coalesce(v_on_account, false) then
    raise exception 'This account is not set up to order on account';
  end if;

  select status, total_amount, subtotal_amount, vat_amount
    into v_quote_status, v_total_amount, v_subtotal_amount, v_vat_amount
    from public.quotes
    where id = p_quote_id and customer_id = p_customer_id for update;
  if v_quote_status is null then raise exception 'Quote % not found for this customer', p_quote_id; end if;
  if v_quote_status <> 'submitted' then raise exception 'Quote is not submitted (status: %)', v_quote_status; end if;

  perform 1 from public.products p join public.quote_items qi on qi.product_id = p.id
    where qi.quote_id = p_quote_id for update of p;
  select qi.product_id, qi.quantity, p.stock_quantity into v_short_product_id, v_short_requested, v_short_available
    from public.quote_items qi join public.products p on p.id = qi.product_id
    where qi.quote_id = p_quote_id and p.stock_quantity < qi.quantity limit 1;

  if v_short_product_id is null then
    insert into public.orders (quote_id, customer_id, total_amount, subtotal_amount, vat_amount, status, source)
      values (p_quote_id, p_customer_id, v_total_amount, v_subtotal_amount, v_vat_amount, 'awaiting_payment', 'portal') returning id into v_order_id;
    insert into public.order_items (order_id, product_id, quantity, unit_price, vat_rate)
      select v_order_id, product_id, quantity, unit_price, vat_rate from public.quote_items where quote_id = p_quote_id;
    update public.products p set stock_quantity = p.stock_quantity - qi.quantity
      from public.quote_items qi where qi.quote_id = p_quote_id and qi.product_id = p.id;
    update public.quotes set status = 'converted' where id = p_quote_id;
    return query select v_order_id, 'awaiting_payment'::public.order_status, null::uuid, null::integer, null::integer;
  else
    insert into public.orders (quote_id, customer_id, total_amount, subtotal_amount, vat_amount, status, source)
      values (p_quote_id, p_customer_id, v_total_amount, v_subtotal_amount, v_vat_amount, 'pending_approval', 'portal') returning id into v_order_id;
    insert into public.order_items (order_id, product_id, quantity, unit_price, vat_rate)
      select v_order_id, product_id, quantity, unit_price, vat_rate from public.quote_items where quote_id = p_quote_id;
    update public.quotes set status = 'converted' where id = p_quote_id;
    return query select v_order_id, 'pending_approval'::public.order_status, v_short_product_id, v_short_requested, v_short_available;
  end if;
end;
$$;

-- Same lockdown as every other SECURITY DEFINER function here: Supabase
-- grants EXECUTE on new public functions to anon and authenticated, which
-- would let anyone holding the public anon key call this directly and skip
-- the API's own checks.
revoke execute on function public.checkout_quote_on_account(uuid, uuid) from public, anon, authenticated;
grant execute on function public.checkout_quote_on_account(uuid, uuid) to service_role;

-- Verification:
-- select column_name from information_schema.columns
--   where table_name = 'users' and column_name = 'can_order_on_account';
-- select proname from pg_proc where proname = 'checkout_quote_on_account';

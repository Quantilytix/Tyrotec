-- VAT-exclusive pricing. Run once in the Supabase SQL Editor. Safe to run
-- more than once.
--
-- Until now product prices were VAT-inclusive and a document's VAT was worked
-- backwards out of the total (total x 15/115). Tyrotec is a registered VAT
-- vendor selling to both VAT-registered and non-registered businesses, and
-- prices are quoted the way that trade does it: excluding VAT, with VAT added
-- per line.
--
-- WHAT THIS DOES NOT DO: it does not touch existing product prices, quotes, or
-- orders.
--   * products.unit_price values stay exactly as they are. They are simply
--     *read* as excl-VAT from now on, and the owner is reworking the price
--     list himself. Totals will therefore be ~15% higher until he does.
--   * Existing quotes and orders keep their stored totals and print exactly as
--     they did. They are marked legacy by having NULL subtotal/vat amounts
--     (and NULL quote_items.vat_rate), which the documents treat as
--     "the price already included VAT" -- a customer's copy of a document must
--     never change after the fact.

-- Per-product, because zero-rated or exempt lines are a property of the goods,
-- not of the customer. Defaults to true: standard-rated is the normal case.
alter table public.products
  add column if not exists vat_applicable boolean not null default true;

-- Declared at signup. Does NOT change whether VAT is charged (it always is on
-- standard-rated goods) -- it records who can claim the VAT back, and drives
-- whether a VAT number is required from them.
alter table public.users
  add column if not exists is_vat_registered boolean not null default false;

-- Anyone who already gave a VAT number is, by definition, registered.
update public.users
set is_vat_registered = true
where is_vat_registered = false
  and vat_number is not null
  and btrim(vat_number) <> '';

-- Nullable on purpose: NULL means "legacy, VAT-inclusive pricing", which is
-- how rows written before this migration are read. New rows always set them.
alter table public.quotes
  add column if not exists subtotal_amount numeric check (subtotal_amount is null or subtotal_amount >= 0),
  add column if not exists vat_amount numeric check (vat_amount is null or vat_amount >= 0);

alter table public.orders
  add column if not exists subtotal_amount numeric check (subtotal_amount is null or subtotal_amount >= 0),
  add column if not exists vat_amount numeric check (vat_amount is null or vat_amount >= 0);

-- The rate actually charged on the line (15 or 0), not a yes/no flag: if the
-- VAT rate ever changes, every past document still states what it charged.
alter table public.quote_items
  add column if not exists vat_rate numeric check (vat_rate is null or (vat_rate >= 0 and vat_rate <= 100));

alter table public.order_items
  add column if not exists vat_rate numeric check (vat_rate is null or (vat_rate >= 0 and vat_rate <= 100));

-- Fast checkout copies a quote into an order, so it has to carry the new
-- amounts across -- otherwise a PayFast order would lose its VAT breakdown.
-- Unchanged from 000_fresh_database_schema.sql apart from those columns.
create or replace function public.checkout_quote_with_reservation(
  p_quote_id uuid, p_customer_id uuid, p_reservation_minutes integer default 60
) returns table (order_id uuid, order_status public.order_status, short_product_id uuid, short_requested integer, short_available integer)
language plpgsql security definer set search_path = public as $$
declare
  v_quote_status public.quote_status; v_total_amount numeric; v_order_id uuid;
  v_subtotal_amount numeric; v_vat_amount numeric;
  v_short_product_id uuid; v_short_requested integer; v_short_available integer;
begin
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
      values (p_quote_id, p_customer_id, v_total_amount, v_subtotal_amount, v_vat_amount, 'stock_reserved', 'portal') returning id into v_order_id;
    insert into public.order_items (order_id, product_id, quantity, unit_price, vat_rate)
      select v_order_id, product_id, quantity, unit_price, vat_rate from public.quote_items where quote_id = p_quote_id;
    update public.products p set stock_quantity = p.stock_quantity - qi.quantity
      from public.quote_items qi where qi.quote_id = p_quote_id and qi.product_id = p.id;
    insert into public.stock_reservations (order_id, product_id, quantity, expires_at)
      select v_order_id, product_id, quantity, now() + (p_reservation_minutes || ' minutes')::interval
      from public.quote_items where quote_id = p_quote_id;
    update public.quotes set status = 'converted' where id = p_quote_id;
    return query select v_order_id, 'stock_reserved'::public.order_status, null::uuid, null::integer, null::integer;
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

revoke execute on function public.checkout_quote_with_reservation(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.checkout_quote_with_reservation(uuid, uuid, integer) to service_role;

-- Verification:
-- select count(*) filter (where vat_applicable) as vat_products, count(*) as products from public.products;
-- select count(*) filter (where is_vat_registered) as vat_registered, count(*) as users from public.users;

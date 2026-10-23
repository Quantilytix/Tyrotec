-- Product discounts.
--
-- An admin creates a discount -- a reason the customer sees, a percentage
-- off, an optional last day -- and picks the products it applies to.
-- Customers see those products under "On discount", with the reason and both
-- prices.
--
-- - One active discount per product, so a product's price is never ambiguous.
-- - The price is worked out by the server when a quote is saved, never sent
--   by the browser. Quote lines (and the order lines copied from them) keep
--   the original price, the percentage and the reason, so documents show
--   what the customer saved.
-- - A quote priced with a discount can't be accepted once that discount has
--   ended (the API checks this); the customer gets an updated quote instead.
--
-- products.discount_* mirrors the product's current discount, so catalogue
-- reads and the "On discount" filter are a plain column check. Only the
-- functions below write those columns. A discount past its last day is
-- cleared from products by clear_expired_discounts(), which the API runs
-- before listing discounted products and the jobs run every few minutes;
-- pricing checks the last day itself, so a late clear never under-charges.
--
-- Run after 037. Safe to run more than once.

-- 1. Discounts --------------------------------------------------------------------

create table if not exists public.discounts (
  id uuid primary key default gen_random_uuid(),
  reason text not null check (btrim(reason) <> ''),
  percent numeric(5,2) not null check (percent > 0 and percent < 100),
  -- Last day it applies, as a South African date. Null: until ended.
  ends_on date,
  -- Set when an admin ends it early.
  ended_at timestamptz,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.discount_products (
  discount_id uuid not null references public.discounts(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  primary key (discount_id, product_id)
);
create index if not exists discount_products_product_idx on public.discount_products (product_id);

alter table public.discounts enable row level security;
alter table public.discount_products enable row level security;
revoke all on public.discounts, public.discount_products from anon, authenticated;

-- 2. A product's current discount ------------------------------------------------

alter table public.products add column if not exists discount_id uuid references public.discounts(id) on delete set null;
alter table public.products add column if not exists discount_percent numeric(5,2);
alter table public.products add column if not exists discount_reason text;
alter table public.products add column if not exists discount_ends_on date;
create index if not exists products_discount_idx on public.products (discount_id) where discount_id is not null;

-- Customers may read these alongside the other catalogue columns (032).
grant select (discount_id, discount_percent, discount_reason, discount_ends_on)
  on public.products to authenticated;

-- 3. Discounts on quote and order lines ------------------------------------------

alter table public.quote_items add column if not exists list_price numeric(12,2);
alter table public.quote_items add column if not exists discount_id uuid references public.discounts(id) on delete set null;
alter table public.quote_items add column if not exists discount_percent numeric(5,2);
alter table public.quote_items add column if not exists discount_reason text;

alter table public.order_items add column if not exists list_price numeric(12,2);
alter table public.order_items add column if not exists discount_id uuid references public.discounts(id) on delete set null;
alter table public.order_items add column if not exists discount_percent numeric(5,2);
alter table public.order_items add column if not exists discount_reason text;

-- Order lines are copied from quote lines in several places (the checkout
-- function, the API, WhatsApp). Rather than change each, this fills in the
-- discount from the matching quote line whenever an order line is created.
create or replace function public.copy_quote_line_discount()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.discount_id is null then
    select qi.list_price, qi.discount_id, qi.discount_percent, qi.discount_reason
      into new.list_price, new.discount_id, new.discount_percent, new.discount_reason
      from public.quote_items qi
      join public.orders o on o.quote_id = qi.quote_id
     where o.id = new.order_id and qi.product_id = new.product_id
     limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists copy_quote_line_discount on public.order_items;
create trigger copy_quote_line_discount
  before insert on public.order_items
  for each row execute function public.copy_quote_line_discount();

-- 4. Functions ---------------------------------------------------------------------

-- Today in South Africa, which is what a discount's last day is measured in.
create or replace function public.sa_today()
returns date language sql stable as $$
  select (now() at time zone 'Africa/Johannesburg')::date;
$$;

-- Clears discounts past their last day from products. Returns how many.
create or replace function public.clear_expired_discounts()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  update public.products
     set discount_id = null, discount_percent = null, discount_reason = null, discount_ends_on = null
   where discount_id is not null and discount_ends_on < public.sa_today();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Creates a discount on the given products, all or nothing. Refuses if any
-- of them already has an active discount.
create or replace function public.create_discount(
  p_reason text, p_percent numeric, p_ends_on date, p_product_ids uuid[], p_created_by uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_taken text;
  v_found integer;
begin
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Enter the reason for the discount'; end if;
  if p_percent is null or p_percent <= 0 or p_percent >= 100 then
    raise exception 'The discount must be more than 0%% and less than 100%%';
  end if;
  if p_ends_on is not null and p_ends_on < public.sa_today() then
    raise exception 'The last day can''t be in the past';
  end if;
  if p_product_ids is null or cardinality(p_product_ids) = 0 then
    raise exception 'Pick at least one product';
  end if;

  perform public.clear_expired_discounts();
  perform 1 from public.products where id = any(p_product_ids) order by id for update;

  select count(*) into v_found from public.products where id = any(p_product_ids);
  if v_found <> (select count(distinct x) from unnest(p_product_ids) x) then
    raise exception 'One or more products were not found';
  end if;

  select string_agg(sku, ', ' order by sku) into v_taken
    from public.products where id = any(p_product_ids) and discount_id is not null;
  if v_taken is not null then
    raise exception 'Already on discount: %', v_taken;
  end if;

  insert into public.discounts (reason, percent, ends_on, created_by)
    values (btrim(p_reason), round(p_percent, 2), p_ends_on, p_created_by)
    returning id into v_id;
  insert into public.discount_products (discount_id, product_id)
    select v_id, x from (select distinct unnest(p_product_ids) as x) ids;
  update public.products
     set discount_id = v_id, discount_percent = round(p_percent, 2),
         discount_reason = btrim(p_reason), discount_ends_on = p_ends_on
   where id = any(p_product_ids);
  return v_id;
end;
$$;

-- Ends a discount now. Quotes priced with it can no longer be accepted.
create or replace function public.end_discount(p_discount_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.discounts set ended_at = now() where id = p_discount_id and ended_at is null;
  if not found then
    if not exists (select 1 from public.discounts where id = p_discount_id) then
      raise exception 'Discount not found';
    end if;
    raise exception 'This discount has already ended';
  end if;
  update public.products
     set discount_id = null, discount_percent = null, discount_reason = null, discount_ends_on = null
   where discount_id = p_discount_id;
end;
$$;

revoke execute on function public.copy_quote_line_discount() from public, anon, authenticated;
revoke execute on function public.clear_expired_discounts() from public, anon, authenticated;
revoke execute on function public.create_discount(text, numeric, date, uuid[], uuid) from public, anon, authenticated;
revoke execute on function public.end_discount(uuid) from public, anon, authenticated;
grant execute on function public.clear_expired_discounts() to service_role;
grant execute on function public.create_discount(text, numeric, date, uuid[], uuid) to service_role;
grant execute on function public.end_discount(uuid) to service_role;

-- Verification:
-- select tablename from pg_tables where tablename in ('discounts', 'discount_products');  -- 2 rows
-- select count(*) from information_schema.columns
--  where table_name in ('products', 'quote_items', 'order_items') and column_name like 'discount_%';  -- 10

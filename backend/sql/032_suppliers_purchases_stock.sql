-- Suppliers, purchases, stock adjustments and opening stock.
--
-- Until now stock only went up when someone typed a new number on the product
-- form (or a receipt import added to it), with no cost, supplier or paper
-- trail. From here on every stock change has a reason:
--
--   + a purchase    goods received from a supplier, at a cost   receive_purchase()
--   - a sale        order approval / checkout (existing RPCs)
--   + a cancellation stock returned (existing RPCs)
--   +/- an adjustment damaged, lost, count correction...       adjust_stock()
--   + opening stock  what was on the shelf at go-live, once     record_opening_stock()
--
-- products.supplier_cost becomes the product's weighted-average cost: each
-- purchase blends the new units' cost into it. It is no longer typed in.
-- These records are also what the QX connector sends to QX's books.
--
-- Also: customers can no longer read products' supplier details or costs
-- directly through Supabase (column-level grants below).
--
-- Tyrotec sells products only (no services), so every product holds stock.
--
-- Safe to run more than once.

-- 1. Suppliers ----------------------------------------------------------------

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name varchar(150) not null check (btrim(name) <> ''),
  email varchar(150),
  phone varchar(50),
  location varchar(150),
  vat_number varchar(30),
  credit_terms_days integer not null default 30 check (credit_terms_days between 0 and 365),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists suppliers_name_unique on public.suppliers (lower(btrim(name)));
alter table public.suppliers enable row level security;

alter table public.products add column if not exists supplier_id uuid references public.suppliers(id);
create index if not exists products_supplier_id_idx on public.products (supplier_id);

-- One supplier per distinct name already typed on products (newest details win).
insert into public.suppliers (name, email, phone, location)
select distinct on (lower(btrim(supplier_name)))
       btrim(supplier_name), nullif(btrim(supplier_email), ''), nullif(btrim(supplier_phone), ''),
       nullif(btrim(supplier_location), '')
  from public.products
 where supplier_name is not null and btrim(supplier_name) <> ''
 order by lower(btrim(supplier_name)), updated_at desc
on conflict ((lower(btrim(name)))) do nothing;

update public.products p
   set supplier_id = s.id
  from public.suppliers s
 where p.supplier_id is null
   and p.supplier_name is not null
   and lower(btrim(p.supplier_name)) = lower(btrim(s.name));

-- 2. Purchases ----------------------------------------------------------------

create sequence if not exists public.purchases_purchase_number_seq;
create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  purchase_number bigint not null unique default nextval('public.purchases_purchase_number_seq'),
  supplier_id uuid not null references public.suppliers(id),
  -- The supplier's own invoice/delivery number, as printed on their document.
  supplier_invoice_number varchar(100) not null check (btrim(supplier_invoice_number) <> ''),
  purchase_date date not null,
  due_date date,
  notes text,
  -- All excl. VAT except total_amount; the parts add up to it.
  subtotal_amount numeric not null check (subtotal_amount >= 0),
  vat_amount numeric not null check (vat_amount >= 0),
  total_amount numeric not null check (total_amount >= 0),
  received_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter sequence public.purchases_purchase_number_seq owned by public.purchases.purchase_number;
-- The same supplier invoice can't be captured twice.
create unique index if not exists purchases_supplier_invoice_unique
  on public.purchases (supplier_id, lower(btrim(supplier_invoice_number)));
alter table public.purchases enable row level security;

create table if not exists public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity integer not null check (quantity > 0),
  unit_cost numeric not null check (unit_cost >= 0),          -- excl. VAT
  vat_rate numeric not null check (vat_rate in (0, 15))
);
create index if not exists purchase_items_purchase_idx on public.purchase_items (purchase_id);
create index if not exists purchase_items_product_idx on public.purchase_items (product_id);
alter table public.purchase_items enable row level security;

-- 3. Stock adjustments --------------------------------------------------------

create table if not exists public.stock_adjustments (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  quantity_change integer not null check (quantity_change <> 0),
  -- Valued at the product's average cost at the time (excl. VAT).
  unit_cost numeric not null check (unit_cost >= 0),
  reason varchar(30) not null check (reason in ('damaged', 'lost', 'count_correction', 'returned_to_supplier', 'other')),
  note text,
  stock_before integer not null,
  stock_after integer not null check (stock_after >= 0),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists stock_adjustments_product_idx on public.stock_adjustments (product_id, created_at desc);
alter table public.stock_adjustments enable row level security;

-- 4. Opening stock (recorded once) ---------------------------------------------

create table if not exists public.opening_stock (
  id uuid primary key default gen_random_uuid(),
  as_of_date date not null,
  -- [{ product_id, sku, name, quantity, unit_cost }]
  lines jsonb not null,
  total_value numeric not null check (total_value >= 0),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  only_once boolean not null default true unique check (only_once)
);
alter table public.opening_stock enable row level security;

-- 5. Functions -------------------------------------------------------------------

-- Records goods received from a supplier: the purchase, its lines, the stock
-- increase and the new weighted-average cost, all or nothing.
-- p_lines: [{ "product_id": uuid, "quantity": int, "unit_cost": numeric, "vat_rate": 0|15 }]
create or replace function public.receive_purchase(
  p_supplier_id uuid, p_supplier_invoice_number text, p_purchase_date date, p_due_date date,
  p_notes text, p_lines jsonb, p_received_by uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_purchase_id uuid;
  v_line jsonb;
  v_product record;
  v_qty integer;
  v_cost numeric;
  v_rate numeric;
  v_subtotal numeric := 0;
  v_vat numeric := 0;
begin
  if not exists (select 1 from public.suppliers where id = p_supplier_id and is_active) then
    raise exception 'Supplier not found or inactive';
  end if;
  if p_supplier_invoice_number is null or btrim(p_supplier_invoice_number) = '' then
    raise exception 'The supplier''s invoice number is required';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'A purchase needs at least one line';
  end if;

  -- Lock every product on the purchase up front, in a fixed order, so two
  -- purchases (or a purchase and a checkout) can't deadlock or lose an update.
  perform 1 from public.products
    where id in (select (l->>'product_id')::uuid from jsonb_array_elements(p_lines) l)
    order by id for update;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := (v_line->>'quantity')::integer;
    v_cost := round((v_line->>'unit_cost')::numeric, 2);
    v_rate := coalesce((v_line->>'vat_rate')::numeric, 15);
    if v_qty is null or v_qty <= 0 then raise exception 'Every line needs a quantity above 0'; end if;
    if v_cost is null or v_cost < 0 then raise exception 'Every line needs a unit cost of 0 or more'; end if;
    if v_rate not in (0, 15) then raise exception 'VAT rate must be 0 or 15'; end if;
    select id, sku into v_product from public.products where id = (v_line->>'product_id')::uuid;
    if v_product.id is null then raise exception 'Product % not found', v_line->>'product_id'; end if;
    v_subtotal := v_subtotal + round(v_qty * v_cost, 2);
    v_vat := v_vat + round(v_qty * v_cost * v_rate / 100, 2);
  end loop;

  insert into public.purchases
    (supplier_id, supplier_invoice_number, purchase_date, due_date, notes,
     subtotal_amount, vat_amount, total_amount, received_by)
  values
    (p_supplier_id, btrim(p_supplier_invoice_number), p_purchase_date, p_due_date, nullif(btrim(p_notes), ''),
     v_subtotal, v_vat, v_subtotal + v_vat, p_received_by)
  returning id into v_purchase_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := (v_line->>'quantity')::integer;
    v_cost := round((v_line->>'unit_cost')::numeric, 2);
    v_rate := coalesce((v_line->>'vat_rate')::numeric, 15);
    insert into public.purchase_items (purchase_id, product_id, quantity, unit_cost, vat_rate)
      values (v_purchase_id, (v_line->>'product_id')::uuid, v_qty, v_cost, v_rate);
    -- Weighted average: what's on the shelf at its average cost, plus the new
    -- units at what they cost. No stock (or no known cost) -> the new cost.
    update public.products
       set supplier_cost = case
             when stock_quantity > 0 and supplier_cost is not null
               then round((stock_quantity * supplier_cost + v_qty * v_cost) / (stock_quantity + v_qty), 2)
             else v_cost
           end,
           stock_quantity = stock_quantity + v_qty,
           updated_at = now()
     where id = (v_line->>'product_id')::uuid;
  end loop;

  return v_purchase_id;
end;
$$;

-- Corrects stock for anything that isn't a purchase or a sale. Valued at the
-- product's average cost; p_unit_cost is only used (and then required) when
-- the product has no cost yet.
create or replace function public.adjust_stock(
  p_product_id uuid, p_quantity_change integer, p_reason text, p_note text,
  p_unit_cost numeric, p_created_by uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_product record;
  v_cost numeric;
  v_id uuid;
begin
  if p_quantity_change is null or p_quantity_change = 0 then
    raise exception 'The change must be a whole number other than 0';
  end if;
  select id, sku, stock_quantity, supplier_cost into v_product
    from public.products where id = p_product_id for update;
  if v_product.id is null then raise exception 'Product not found'; end if;
  if v_product.stock_quantity + p_quantity_change < 0 then
    raise exception 'Only % in stock; can''t remove %', v_product.stock_quantity, -p_quantity_change;
  end if;

  v_cost := v_product.supplier_cost;
  if v_cost is null then
    if p_unit_cost is null or p_unit_cost < 0 then
      raise exception '% has no cost yet. Enter its unit cost.', v_product.sku;
    end if;
    v_cost := round(p_unit_cost, 2);
  end if;

  insert into public.stock_adjustments
    (product_id, quantity_change, unit_cost, reason, note, stock_before, stock_after, created_by)
  values
    (p_product_id, p_quantity_change, v_cost, p_reason, nullif(btrim(p_note), ''),
     v_product.stock_quantity, v_product.stock_quantity + p_quantity_change, p_created_by)
  returning id into v_id;

  update public.products
     set stock_quantity = stock_quantity + p_quantity_change,
         supplier_cost = coalesce(supplier_cost, v_cost),
         updated_at = now()
   where id = p_product_id;
  return v_id;
end;
$$;

-- Records, once, the value of the stock on hand at go-live: every product
-- with stock, at its cost. p_costs ({ product_id: cost }) fills in
-- products that have no cost yet.
create or replace function public.record_opening_stock(
  p_as_of_date date, p_costs jsonb, p_created_by uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_missing text;
  v_lines jsonb;
  v_total numeric;
  v_id uuid;
begin
  if exists (select 1 from public.opening_stock) then
    raise exception 'Opening stock has already been recorded';
  end if;

  perform 1 from public.products where stock_quantity > 0 order by id for update;

  if p_costs is not null and jsonb_typeof(p_costs) = 'object' then
    update public.products p
       set supplier_cost = round((c.value #>> '{}')::numeric, 2), updated_at = now()
      from jsonb_each(p_costs) c
     where p.id = c.key::uuid and p.supplier_cost is null and (c.value #>> '{}')::numeric >= 0;
  end if;

  select string_agg(sku, ', ' order by sku) into v_missing
    from public.products
   where stock_quantity > 0 and supplier_cost is null;
  if v_missing is not null then
    raise exception 'These products have stock but no cost: %', v_missing;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'product_id', id, 'sku', sku, 'name', name,
           'quantity', stock_quantity, 'unit_cost', supplier_cost) order by sku), '[]'::jsonb),
         coalesce(sum(round(stock_quantity * supplier_cost, 2)), 0)
    into v_lines, v_total
    from public.products
   where stock_quantity > 0;

  insert into public.opening_stock (as_of_date, lines, total_value, created_by)
    values (p_as_of_date, v_lines, v_total, p_created_by)
    returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.receive_purchase(uuid, text, date, date, text, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.adjust_stock(uuid, integer, text, text, numeric, uuid) from public, anon, authenticated;
revoke execute on function public.record_opening_stock(date, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.receive_purchase(uuid, text, date, date, text, jsonb, uuid) to service_role;
grant execute on function public.adjust_stock(uuid, integer, text, text, numeric, uuid) to service_role;
grant execute on function public.record_opening_stock(date, jsonb, uuid) to service_role;

-- 6. Keep costs and supplier details away from customers ------------------------

-- The products_select_all policy lets any signed-in user read products straight
-- from Supabase. Limit that to the catalogue columns; the backend (service
-- role) still reads everything.
revoke select on public.products from anon, authenticated;
grant select (id, sku, name, category, description, unit_price, vat_applicable, stock_quantity,
              availability, lead_time_days, min_order_qty, image_url, created_at, updated_at)
  on public.products to authenticated;
revoke all on public.suppliers, public.purchases, public.purchase_items,
              public.stock_adjustments, public.opening_stock from anon, authenticated;

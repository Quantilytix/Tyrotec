-- Tyrotec / Jamlea fresh Supabase database bootstrap
--
-- PURPOSE
-- Run this ONCE in the SQL Editor of a brand-new Supabase project. It creates
-- the complete, current application schema without copying any data from the
-- old project: no users, products, quotes, orders, payments, or notifications.
--
-- BEFORE RUNNING
--   1. Create a new Supabase project.
--   2. Open its SQL Editor and run this whole file as one query.
--   3. Configure the new project's Auth providers and Storage settings.
--   4. Point SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (backend) and
--      VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (frontend) at the new project.
--
-- This file intentionally does not seed products. Add products through the
-- admin portal or import them after deployment.
--
-- FIRST ADMIN
-- Register a normal account once (or create it in Supabase Auth), then run:
--   update public.users set role = 'admin', status = 'approved'
--   where email = 'your-admin-email@example.com';

create extension if not exists pgcrypto;

-- Application enums
create type public.user_role as enum ('admin', 'sales_rep', 'customer');
create type public.account_status as enum ('pending', 'approved', 'rejected');
create type public.request_source as enum ('portal', 'whatsapp', 'admin');
create type public.quote_status as enum ('draft', 'submitted', 'converted', 'expired');
create type public.order_status as enum (
  'pending_approval', 'approved', 'processing', 'completed', 'cancelled',
  'stock_reserved', 'confirmed', 'ready_for_collection'
);
create type public.payment_status as enum ('submitted', 'approved', 'rejected');
create type public.notification_type as enum (
  'quote_submitted', 'quote_converted', 'order_status_changed', 'general'
);
create type public.admin_review_reason as enum ('stock_short', 'manual_payment', 'high_value', 'new_customer');
create type public.admin_review_status as enum ('pending', 'resolved');

-- Profiles are always tied to Supabase Auth users. Create the initial admin
-- through Supabase Auth (or the backend) after this migration has run.
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email varchar(255) not null unique,
  company_name varchar(255),
  full_name varchar(255),
  role public.user_role not null default 'customer',
  status public.account_status not null default 'approved',
  phone varchar(20) unique,
  vat_number varchar(30),
  address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku varchar(100) not null unique,
  name varchar(255) not null,
  category varchar(100) not null,
  description text,
  unit_price numeric not null check (unit_price >= 0),
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  availability varchar(20) not null check (availability in ('local', 'national', 'global')),
  lead_time_days integer not null default 0 check (lead_time_days >= 0),
  min_order_qty integer not null default 1 check (min_order_qty >= 1),
  image_url text,
  supplier_name varchar(150),
  supplier_location varchar(150),
  supplier_email varchar(150),
  supplier_phone varchar(50),
  supplier_cost numeric check (supplier_cost is null or supplier_cost >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create sequence public.quotes_quote_number_seq;
create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  quote_number bigint not null unique default nextval('public.quotes_quote_number_seq'),
  customer_id uuid not null references public.users(id) on delete cascade,
  total_amount numeric not null check (total_amount >= 0),
  status public.quote_status not null default 'submitted',
  source public.request_source not null default 'portal',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter sequence public.quotes_quote_number_seq owned by public.quotes.quote_number;

create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity integer not null check (quantity > 0),
  unit_price numeric not null check (unit_price >= 0)
);

create sequence public.orders_order_number_seq;
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint not null unique default nextval('public.orders_order_number_seq'),
  quote_id uuid not null unique references public.quotes(id),
  customer_id uuid not null references public.users(id) on delete cascade,
  total_amount numeric not null check (total_amount >= 0),
  status public.order_status not null default 'pending_approval',
  source public.request_source not null default 'portal',
  reservation_warned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter sequence public.orders_order_number_seq owned by public.orders.order_number;

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity integer not null check (quantity > 0),
  unit_price numeric not null check (unit_price >= 0)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  type public.notification_type not null default 'general',
  title varchar(200) not null,
  message text not null,
  related_type varchar(50),
  related_id uuid,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  customer_id uuid not null references public.users(id) on delete cascade,
  method varchar(50) not null,
  reference varchar(100) not null,
  amount numeric not null check (amount > 0),
  note text,
  status public.payment_status not null default 'submitted',
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  source varchar(20) not null default 'portal',
  gateway varchar(20) not null default 'manual',
  gateway_reference varchar(100) unique,
  gateway_status varchar(30),
  verified_at timestamptz,
  proof_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.stock_reservations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity integer not null check (quantity > 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.admin_reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  reason public.admin_review_reason not null,
  status public.admin_review_status not null default 'pending',
  assigned_to uuid references public.users(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  phone varchar(20) not null unique,
  user_id uuid references public.users(id) on delete set null,
  state varchar(50) not null default 'main_menu',
  context jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.whatsapp_processed_messages (
  wamid varchar(100) primary key,
  created_at timestamptz not null default now()
);

create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.users(id) on delete set null,
  actor_label text not null,
  action varchar(100) not null,
  entity_type varchar(50),
  entity_id uuid,
  description text not null,
  created_at timestamptz not null default now()
);

-- Performance indexes used by portal lists, administration, and cron jobs.
create index quotes_customer_id_idx on public.quotes(customer_id);
create index quote_items_quote_id_idx on public.quote_items(quote_id);
create index orders_customer_id_idx on public.orders(customer_id);
create index orders_status_idx on public.orders(status);
create index order_items_order_id_idx on public.order_items(order_id);
create index notifications_user_id_idx on public.notifications(user_id);
create index notifications_user_unread_idx on public.notifications(user_id) where is_read = false;
create index payments_order_id_idx on public.payments(order_id);
create index payments_customer_id_idx on public.payments(customer_id);
create index stock_reservations_order_id_idx on public.stock_reservations(order_id);
create index stock_reservations_expires_at_idx on public.stock_reservations(expires_at);
create index admin_reviews_status_idx on public.admin_reviews(status);
create index admin_reviews_order_id_idx on public.admin_reviews(order_id);
create index whatsapp_conversations_phone_idx on public.whatsapp_conversations(phone);
create index activity_log_created_at_idx on public.activity_log(created_at desc);
create index activity_log_entity_idx on public.activity_log(entity_type, entity_id);

-- Keep profile/product timestamps correct for direct database edits as well.
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger users_set_updated_at before update on public.users for each row execute function public.set_updated_at();
create trigger products_set_updated_at before update on public.products for each row execute function public.set_updated_at();
create trigger quotes_set_updated_at before update on public.quotes for each row execute function public.set_updated_at();
create trigger orders_set_updated_at before update on public.orders for each row execute function public.set_updated_at();
create trigger payments_set_updated_at before update on public.payments for each row execute function public.set_updated_at();

-- Auth profile sync. The backend also upserts profiles after signup to avoid
-- depending on trigger timing, but this keeps direct Supabase signups valid.
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email, company_name, full_name, role)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'company_name',
    new.raw_user_meta_data->>'full_name',
    coalesce((new.raw_user_meta_data->>'role')::public.user_role, 'customer')
  ) on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Atomic manual approval and cancellation, including stock management.
create or replace function public.approve_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_status public.order_status; v_item record;
begin
  select status into v_status from public.orders where id = p_order_id for update;
  if v_status is null then raise exception 'Order % not found', p_order_id; end if;
  if v_status <> 'pending_approval' then
    raise exception 'Order % is not pending approval (current status: %)', p_order_id, v_status;
  end if;
  for v_item in
    select oi.quantity, p.stock_quantity, p.name from public.order_items oi
    join public.products p on p.id = oi.product_id where oi.order_id = p_order_id for update of p
  loop
    if v_item.stock_quantity < v_item.quantity then
      raise exception 'Insufficient stock for product % (have %, need %)', v_item.name, v_item.stock_quantity, v_item.quantity;
    end if;
  end loop;
  update public.products p set stock_quantity = p.stock_quantity - oi.quantity
    from public.order_items oi where oi.order_id = p_order_id and oi.product_id = p.id;
  update public.orders set status = 'approved' where id = p_order_id;
end;
$$;

create or replace function public.cancel_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_status public.order_status;
begin
  select status into v_status from public.orders where id = p_order_id for update;
  if v_status is null then raise exception 'Order % not found', p_order_id; end if;
  if v_status in ('completed', 'cancelled', 'ready_for_collection') then
    raise exception 'Order % cannot be cancelled from status %', p_order_id, v_status;
  end if;
  if v_status <> 'pending_approval' then
    update public.products p set stock_quantity = p.stock_quantity + oi.quantity
      from public.order_items oi where oi.order_id = p_order_id and oi.product_id = p.id;
  end if;
  delete from public.stock_reservations where stock_reservations.order_id = p_order_id;
  update public.orders set status = 'cancelled' where id = p_order_id;
end;
$$;

-- Fast checkout: locks stock, reserves it when available, otherwise creates
-- a manual-review order without changing stock.
create or replace function public.checkout_quote_with_reservation(
  p_quote_id uuid, p_customer_id uuid, p_reservation_minutes integer default 60
) returns table (order_id uuid, order_status public.order_status, short_product_id uuid, short_requested integer, short_available integer)
language plpgsql security definer set search_path = public as $$
declare
  v_quote_status public.quote_status; v_total_amount numeric; v_order_id uuid;
  v_short_product_id uuid; v_short_requested integer; v_short_available integer;
begin
  select status, total_amount into v_quote_status, v_total_amount from public.quotes
    where id = p_quote_id and customer_id = p_customer_id for update;
  if v_quote_status is null then raise exception 'Quote % not found for this customer', p_quote_id; end if;
  if v_quote_status <> 'submitted' then raise exception 'Quote is not submitted (status: %)', v_quote_status; end if;
  perform 1 from public.products p join public.quote_items qi on qi.product_id = p.id
    where qi.quote_id = p_quote_id for update of p;
  select qi.product_id, qi.quantity, p.stock_quantity into v_short_product_id, v_short_requested, v_short_available
    from public.quote_items qi join public.products p on p.id = qi.product_id
    where qi.quote_id = p_quote_id and p.stock_quantity < qi.quantity limit 1;
  if v_short_product_id is null then
    insert into public.orders (quote_id, customer_id, total_amount, status, source)
      values (p_quote_id, p_customer_id, v_total_amount, 'stock_reserved', 'portal') returning id into v_order_id;
    insert into public.order_items (order_id, product_id, quantity, unit_price)
      select v_order_id, product_id, quantity, unit_price from public.quote_items where quote_id = p_quote_id;
    update public.products p set stock_quantity = p.stock_quantity - qi.quantity
      from public.quote_items qi where qi.quote_id = p_quote_id and qi.product_id = p.id;
    insert into public.stock_reservations (order_id, product_id, quantity, expires_at)
      select v_order_id, product_id, quantity, now() + (p_reservation_minutes || ' minutes')::interval
      from public.quote_items where quote_id = p_quote_id;
    update public.quotes set status = 'converted' where id = p_quote_id;
    return query select v_order_id, 'stock_reserved'::public.order_status, null::uuid, null::integer, null::integer;
  else
    insert into public.orders (quote_id, customer_id, total_amount, status, source)
      values (p_quote_id, p_customer_id, v_total_amount, 'pending_approval', 'portal') returning id into v_order_id;
    insert into public.order_items (order_id, product_id, quantity, unit_price)
      select v_order_id, product_id, quantity, unit_price from public.quote_items where quote_id = p_quote_id;
    update public.quotes set status = 'converted' where id = p_quote_id;
    return query select v_order_id, 'pending_approval'::public.order_status, v_short_product_id, v_short_requested, v_short_available;
  end if;
end;
$$;

create or replace function public.release_expired_reservations()
returns table (order_id uuid) language plpgsql security definer set search_path = public as $$
declare v_order_id uuid; v_released uuid[] := '{}';
begin
  for v_order_id in
    select distinct sr.order_id from public.stock_reservations sr join public.orders o on o.id = sr.order_id
      where sr.expires_at < now() and o.status = 'stock_reserved'
  loop
    perform 1 from public.orders where id = v_order_id for update;
    update public.products p set stock_quantity = p.stock_quantity + sr.quantity
      from public.stock_reservations sr where sr.order_id = v_order_id and sr.product_id = p.id;
    delete from public.stock_reservations where stock_reservations.order_id = v_order_id;
    update public.orders set status = 'cancelled' where id = v_order_id;
    v_released := array_append(v_released, v_order_id);
  end loop;
  return query select unnest(v_released);
end;
$$;

create or replace function public.warn_expiring_reservations(p_lead_minutes integer default 10)
returns table (order_id uuid) language plpgsql security definer set search_path = public as $$
begin
  return query update public.orders o set reservation_warned_at = now()
  from (
    select distinct sr.order_id from public.stock_reservations sr join public.orders oo on oo.id = sr.order_id
    where oo.status = 'stock_reserved' and oo.reservation_warned_at is null
      and sr.expires_at > now() and sr.expires_at <= now() + (p_lead_minutes || ' minutes')::interval
  ) due where o.id = due.order_id returning o.id;
end;
$$;

-- Storage buckets required by product and payment-proof uploads.
insert into storage.buckets (id, name, public) values
  ('Product Images', 'Product Images', true),
  ('payment-proofs', 'payment-proofs', true)
on conflict (id) do nothing;

-- Browser clients only need read access. The Express API uses the Supabase
-- service role, which bypasses RLS, for all writes and administration.
alter table public.users enable row level security;
alter table public.products enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.notifications enable row level security;
alter table public.payments enable row level security;
alter table public.whatsapp_conversations enable row level security;
alter table public.stock_reservations enable row level security;
alter table public.admin_reviews enable row level security;
alter table public.activity_log enable row level security;

create policy users_select_own on public.users for select using (id = auth.uid());
create policy products_select_all on public.products for select using (auth.role() = 'authenticated');
create policy quotes_select_own on public.quotes for select using (customer_id = auth.uid());
create policy quote_items_select_own on public.quote_items for select using (
  exists (select 1 from public.quotes q where q.id = quote_id and q.customer_id = auth.uid())
);
create policy orders_select_own on public.orders for select using (customer_id = auth.uid());
create policy order_items_select_own on public.order_items for select using (
  exists (select 1 from public.orders o where o.id = order_id and o.customer_id = auth.uid())
);
create policy notifications_select_own on public.notifications for select using (user_id = auth.uid());
create policy payments_select_own on public.payments for select using (customer_id = auth.uid());

-- Quick verification: run this after the migration. It should return the
-- application's empty tables, all with a row_count of 0.
-- select relname as table_name, n_live_tup as row_count
-- from pg_stat_user_tables
-- where schemaname = 'public'
-- order by relname;

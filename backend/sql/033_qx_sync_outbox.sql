-- Queue of changes to send to QX (the accounting system this portal feeds).
--
-- Triggers on every table QX needs record "this record changed" here, in the
-- same transaction as the change itself, whichever code made it: the API,
-- WhatsApp flows, or the order/stock database functions. The sync job
-- (src/jobs/syncToQx.js) reads the queue, builds each record from its
-- current data, sends it to QX and marks it done. Nothing is lost if QX is
-- down: entries stay queued and are retried.
--
-- One pending entry per record: changing a record again before it's sent
-- just refreshes that entry. A sent entry is kept 30 days for reference.
--
-- Safe to run more than once.

create table if not exists public.qx_sync_outbox (
  id bigserial primary key,
  entity_type text not null check (entity_type in (
    'customer', 'supplier', 'product', 'quote', 'order', 'payment',
    'purchase', 'stock_adjustment', 'opening_stock')),
  entity_id uuid not null,
  enqueued_at timestamptz not null default now(),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  sent_at timestamptz
);
create unique index if not exists qx_sync_outbox_pending_uk
  on public.qx_sync_outbox (entity_type, entity_id) where sent_at is null;
create index if not exists qx_sync_outbox_due_idx
  on public.qx_sync_outbox (next_attempt_at, id) where sent_at is null;
alter table public.qx_sync_outbox enable row level security;
revoke all on public.qx_sync_outbox from anon, authenticated;

create or replace function public.qx_enqueue(p_type text, p_id uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.qx_sync_outbox (entity_type, entity_id) values (p_type, p_id)
  on conflict (entity_type, entity_id) where sent_at is null
  do update set enqueued_at = now(), next_attempt_at = least(qx_sync_outbox.next_attempt_at, now());
$$;

-- Row trigger. TG_ARGV[0] = what QX calls it; TG_ARGV[1] = the column holding
-- the record's id (default 'id'; 'quote_id' for quote_items, ...).
create or replace function public.qx_outbox_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_type text := TG_ARGV[0];
  v_col text := coalesce(TG_ARGV[1], 'id');
  v_new uuid;
  v_old uuid;
begin
  if TG_OP <> 'DELETE' then
    v_new := (to_jsonb(NEW) ->> v_col)::uuid;
    -- Only customers are customers in QX; staff accounts stay here.
    if v_type = 'customer' and to_jsonb(NEW) ->> 'role' <> 'customer' then v_new := null; end if;
  end if;
  if TG_OP <> 'INSERT' then
    v_old := (to_jsonb(OLD) ->> v_col)::uuid;
    if v_type = 'customer' and to_jsonb(OLD) ->> 'role' <> 'customer' then v_old := null; end if;
  end if;
  if v_new is not null then perform public.qx_enqueue(v_type, v_new); end if;
  if v_old is not null and v_old is distinct from v_new then perform public.qx_enqueue(v_type, v_old); end if;
  return null;
end;
$$;

do $$
declare
  t record;
begin
  for t in select * from (values
    ('users', 'customer', 'id'),
    ('suppliers', 'supplier', 'id'),
    ('products', 'product', 'id'),
    ('quotes', 'quote', 'id'),
    ('quote_items', 'quote', 'quote_id'),
    ('orders', 'order', 'id'),
    ('order_items', 'order', 'order_id'),
    ('payments', 'payment', 'id'),
    ('purchases', 'purchase', 'id'),
    ('purchase_items', 'purchase', 'purchase_id'),
    ('stock_adjustments', 'stock_adjustment', 'id'),
    ('opening_stock', 'opening_stock', 'id')
  ) as v(tbl, kind, col) loop
    execute format('drop trigger if exists qx_outbox on public.%I', t.tbl);
    execute format(
      'create trigger qx_outbox after insert or update or delete on public.%I
         for each row execute function public.qx_outbox_trigger(%L, %L)',
      t.tbl, t.kind, t.col);
  end loop;
end $$;

-- Queues every existing record once (the first sync to a new QX company, or a
-- full re-send). Re-sending is harmless: QX skips what it already has.
create or replace function public.qx_enqueue_all()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer := 0;
  v_n integer;
begin
  insert into public.qx_sync_outbox (entity_type, entity_id)
  select kind, id from (
    select 'customer' as kind, id from public.users where role = 'customer'
    union all select 'supplier', id from public.suppliers
    union all select 'product', id from public.products
    union all select 'quote', id from public.quotes
    union all select 'order', id from public.orders
    union all select 'payment', id from public.payments
    union all select 'purchase', id from public.purchases
    union all select 'stock_adjustment', id from public.stock_adjustments
    union all select 'opening_stock', id from public.opening_stock
  ) all_records
  on conflict (entity_type, entity_id) where sent_at is null do nothing;
  get diagnostics v_n = row_count;
  v_count := v_count + v_n;
  return v_count;
end;
$$;

-- Records what QX said about a batch.
-- p_results: [{ "id": bigint, "enqueued_at": timestamptz, "ok": bool, "error": text }]
-- ok -> done, unless the record changed again since it was read (enqueued_at
-- moved on), in which case it stays queued and the newer version is sent next.
-- not ok -> retried later: 1, 2, 4 ... minutes, at most 6 hours apart.
create or replace function public.qx_outbox_complete(p_results jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.qx_sync_outbox o
     set sent_at = now(), last_error = null
    from jsonb_array_elements(p_results) r
   where o.id = (r ->> 'id')::bigint
     and (r ->> 'ok')::boolean
     and o.sent_at is null
     and o.enqueued_at = (r ->> 'enqueued_at')::timestamptz;

  update public.qx_sync_outbox o
     set attempts = o.attempts + 1,
         last_error = left(r ->> 'error', 1000),
         next_attempt_at = now() + least(interval '1 minute' * power(2, least(o.attempts, 10)), interval '6 hours')
    from jsonb_array_elements(p_results) r
   where o.id = (r ->> 'id')::bigint
     and not (r ->> 'ok')::boolean
     and o.sent_at is null;

  delete from public.qx_sync_outbox where sent_at < now() - interval '30 days';
end;
$$;

revoke execute on function public.qx_enqueue(text, uuid) from public, anon, authenticated;
revoke execute on function public.qx_enqueue_all() from public, anon, authenticated;
revoke execute on function public.qx_outbox_complete(jsonb) from public, anon, authenticated;
grant execute on function public.qx_enqueue(text, uuid) to service_role;
grant execute on function public.qx_enqueue_all() to service_role;
grant execute on function public.qx_outbox_complete(jsonb) to service_role;

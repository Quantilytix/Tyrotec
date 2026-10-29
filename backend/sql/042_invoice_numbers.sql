-- Invoices for staff-made sales.
--
-- When staff turn a quote into a sale for a customer (source = 'admin'),
-- Tyrotec treats it as an invoice, not an order. It is still an order row
-- underneath, so stock, payments, cancelling and QX work as before, but it
-- gets its own unbroken invoice number (shown as INV-0001) and is listed on
-- the Invoices page instead of Orders.
--
-- Existing staff-made orders are numbered oldest first. A cancelled invoice
-- keeps its number, so the sequence never has gaps.
--
-- Run after 041. Safe to run more than once.

alter table public.orders add column if not exists invoice_number bigint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_invoice_number_key') then
    alter table public.orders add constraint orders_invoice_number_key unique (invoice_number);
  end if;
end $$;

create sequence if not exists public.orders_invoice_number_seq owned by public.orders.invoice_number;

-- Number the staff-made orders that don't have one yet, oldest first,
-- carrying on from the highest number already given.
with numbered as (
  select id, row_number() over (order by created_at, order_number) as rn
  from public.orders
  where source = 'admin' and invoice_number is null
)
update public.orders o
set invoice_number = (select coalesce(max(invoice_number), 0) from public.orders) + numbered.rn
from numbered
where numbered.id = o.id;

select setval('public.orders_invoice_number_seq',
  greatest((select coalesce(max(invoice_number), 0) from public.orders), 1),
  (select max(invoice_number) is not null from public.orders));

-- Every new staff-made order gets the next invoice number.
create or replace function public.assign_invoice_number() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.source = 'admin' and new.invoice_number is null then
    new.invoice_number := nextval('public.orders_invoice_number_seq');
  end if;
  return new;
end;
$$;

drop trigger if exists orders_assign_invoice_number on public.orders;
create trigger orders_assign_invoice_number
  before insert on public.orders
  for each row execute function public.assign_invoice_number();

-- Verification:
-- select count(*) filter (where source = 'admin') as staff_orders,
--        count(invoice_number) as numbered
--   from public.orders;  -- the two numbers match

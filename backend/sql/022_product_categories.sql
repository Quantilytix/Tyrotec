-- Managed product categories. Run once in the Supabase SQL Editor. Safe to
-- run more than once.
--
-- Until now `products.category` was free text, so every product form, import
-- and AI guess could invent a new spelling ("Filters" / "filters" / "filter"),
-- which then split the category filter and the analytics "top categories"
-- report into near-duplicates. This table is the managed list staff pick from
-- and maintain (Admin > Products > Manage categories).
--
-- products.category stays a plain text column on purpose -- no foreign key:
--   * Existing products keep whatever category they already have, so the
--     catalogue is never emptied or silently re-labelled by this migration.
--     Staff recategorise them by hand, at their own pace.
--   * Deleting a category is about the *list* of choices, not the products
--     in it: those keep their text and stay visible, searchable and orderable
--     until someone edits them.
-- The API enforces that new/changed categories come from this list.

create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- Case-insensitive uniqueness: "Filters" and "filters" are the same category.
create unique index if not exists product_categories_name_unique
  on public.product_categories (lower(name));

-- The categories agreed with Tyrotec. Staff add and remove their own from the
-- admin screen after this; re-running the file won't resurrect deleted ones.
insert into public.product_categories (name)
values
  ('Diesel Engines'),
  ('Electrical'),
  ('Hydraulic Valves'),
  ('Hydraulic pumps'),
  ('Hydraulic Motors'),
  ('Rock Drills'),
  ('Fed Beams'),
  ('Booms'),
  ('Services'),
  ('Rebuilds'),
  ('Repairs'),
  ('Filters'),
  ('Drive Train')
on conflict do nothing;

-- Browser clients read categories through the API (service role), never
-- directly, so RLS with no policies is correct here: it blocks the anon and
-- authenticated roles outright.
alter table public.product_categories enable row level security;

-- Verification:
-- select name from public.product_categories order by name;

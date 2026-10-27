-- Editable quotes.
--
-- A quote that hasn't been ordered can now be changed: products added or
-- removed, quantities changed -- by the customer it belongs to or by staff.
-- The API prices every line again from today's catalogue (and any current
-- discount) and passes the result here, which swaps the lines and the totals
-- in one transaction. Locking the quote row means an edit and an order being
-- placed from the same quote can't overlap: whichever comes second sees the
-- other's result.
--
-- Run after 039. Safe to run more than once.

create or replace function public.replace_quote_items(
  p_quote_id uuid, p_items jsonb, p_subtotal numeric, p_vat numeric, p_total numeric
) returns void language plpgsql security definer set search_path = public as $$
declare v_status public.quote_status;
begin
  select status into v_status from public.quotes where id = p_quote_id for update;
  if v_status is null then raise exception 'Quote not found'; end if;
  if v_status not in ('draft', 'submitted') then
    raise exception 'Only a quote that has not been ordered can be edited (status: %)', v_status;
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'A quote needs at least one product';
  end if;

  delete from public.quote_items where quote_id = p_quote_id;
  insert into public.quote_items
    (quote_id, product_id, quantity, unit_price, vat_rate, list_price, discount_id, discount_percent, discount_reason)
  select p_quote_id,
         (i ->> 'product_id')::uuid,
         (i ->> 'quantity')::integer,
         (i ->> 'unit_price')::numeric,
         (i ->> 'vat_rate')::numeric,
         (i ->> 'list_price')::numeric,
         (i ->> 'discount_id')::uuid,
         (i ->> 'discount_percent')::numeric,
         i ->> 'discount_reason'
    from jsonb_array_elements(p_items) i;

  update public.quotes
     set subtotal_amount = p_subtotal, vat_amount = p_vat, total_amount = p_total, updated_at = now()
   where id = p_quote_id;
end;
$$;

revoke execute on function public.replace_quote_items(uuid, jsonb, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function public.replace_quote_items(uuid, jsonb, numeric, numeric, numeric) to service_role;

-- Verification:
-- select proname from pg_proc where proname = 'replace_quote_items';  -- 1 row

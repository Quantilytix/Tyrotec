-- Correcting a product's stock and average cost from the product form.
--
-- Stock only changes through purchases, adjustments and orders, and the
-- average cost is worked out by purchases. A typing mistake (a cost missing
-- a 0, a miscounted delivery) left no way to put the cost right. This lets an
-- admin set the correct stock and/or average cost, with a note saying why:
--
--  - a stock change is recorded as a 'count_correction' stock adjustment, the
--    same as Adjust stock, so stock history and QX stay right;
--  - a cost change updates products.supplier_cost; the API records it in the
--    activity log with the note.
--
-- The cost is corrected first, so a stock correction made at the same time is
-- valued at the corrected cost. All in one transaction.
--
-- Run after 040. Safe to run more than once.

create or replace function public.correct_stock_and_cost(
  p_product_id uuid, p_new_stock integer, p_new_cost numeric, p_note text, p_created_by uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_product record;
  v_cost numeric;
  v_adjustment uuid;
begin
  if p_note is null or btrim(p_note) = '' then
    raise exception 'Say why you are making this correction';
  end if;
  select id, sku, stock_quantity, supplier_cost into v_product
    from public.products where id = p_product_id for update;
  if v_product.id is null then raise exception 'Product not found'; end if;
  if p_new_stock is not null and p_new_stock < 0 then raise exception 'Stock can''t be below 0'; end if;
  if p_new_cost is not null and p_new_cost < 0 then raise exception 'The average cost can''t be below 0'; end if;

  v_cost := coalesce(round(p_new_cost, 2), v_product.supplier_cost);
  if p_new_cost is not null and round(p_new_cost, 2) is distinct from v_product.supplier_cost then
    update public.products set supplier_cost = v_cost, updated_at = now() where id = p_product_id;
  end if;

  if p_new_stock is not null and p_new_stock <> v_product.stock_quantity then
    if v_cost is null then
      raise exception '% has no average cost yet. Enter it as well.', v_product.sku;
    end if;
    insert into public.stock_adjustments
      (product_id, quantity_change, unit_cost, reason, note, stock_before, stock_after, created_by)
    values
      (p_product_id, p_new_stock - v_product.stock_quantity, v_cost, 'count_correction', btrim(p_note),
       v_product.stock_quantity, p_new_stock, p_created_by)
    returning id into v_adjustment;
    update public.products set stock_quantity = p_new_stock, updated_at = now() where id = p_product_id;
  end if;

  return jsonb_build_object(
    'stock_before', v_product.stock_quantity,
    'stock_after', coalesce(p_new_stock, v_product.stock_quantity),
    'cost_before', v_product.supplier_cost,
    'cost_after', v_cost,
    'adjustment_id', v_adjustment
  );
end;
$$;

revoke execute on function public.correct_stock_and_cost(uuid, integer, numeric, text, uuid) from public, anon, authenticated;
grant execute on function public.correct_stock_and_cost(uuid, integer, numeric, text, uuid) to service_role;

-- Verification:
-- select proname from pg_proc where proname = 'correct_stock_and_cost';  -- 1 row

const supabase = require('../config/supabase');
const { notifyIfLowStockCrossing } = require('../controllers/productController');
const { listCategoryNames } = require('./categoryService');

const DEFAULT_AVAILABILITY = 'local';
const DEFAULT_LEAD_TIME_DAYS = 7;
const DEFAULT_MIN_ORDER_QTY = 1;

function normalizeName(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Best-guess match only, for the review screen to pre-select -- never
// writes anything. Exact SKU match wins; otherwise a normalized-name
// substring match (receipts/spreadsheets rarely carry our internal SKU).
async function matchExtractedRows(rows) {
  const { data: products, error } = await supabase.from('products').select('id, sku, name');
  if (error) throw error;

  const bySku = new Map(products.map((p) => [p.sku.toLowerCase(), p]));

  return rows.map((row) => {
    let match = row.sku ? bySku.get(row.sku.toLowerCase()) : null;

    if (!match) {
      const normalized = normalizeName(row.name);
      match =
        normalized.length > 3
          ? products.find((p) => {
              const pName = normalizeName(p.name);
              return pName === normalized || pName.includes(normalized) || normalized.includes(pName);
            })
          : null;
    }

    return {
      ...row,
      matchedProductId: match?.id || null,
      matchedProductName: match?.name || null,
    };
  });
}

// rows are admin-reviewed/edited, each tagged action: 'restock' | 'create' | 'skip'.
// Row-level try/catch so one bad row (duplicate SKU, product deleted mid-review,
// etc.) doesn't abort the rest of the batch.
async function confirmProductImport(rows) {
  const restocked = [];
  const created = [];
  const errors = [];

  // Read once for the whole batch rather than per row: an import is commonly
  // dozens of rows, and the category list doesn't change mid-import.
  const categoryNames = await listCategoryNames();
  const categoryByLower = new Map(categoryNames.map((name) => [name.toLowerCase(), name]));

  for (const row of rows) {
    if (row.action === 'skip') continue;

    try {
      if (row.action === 'restock') {
        const { data: existing, error: findErr } = await supabase
          .from('products')
          .select('*')
          .eq('id', row.productId)
          .single();
        if (findErr || !existing) throw new Error('Product not found');

        const newStock = existing.stock_quantity + Number(row.quantity || 0);
        const { data: updated, error: updateErr } = await supabase
          .from('products')
          .update({ stock_quantity: newStock })
          .eq('id', row.productId)
          .select()
          .single();
        if (updateErr) throw updateErr;

        await notifyIfLowStockCrossing(existing.stock_quantity, updated);
        restocked.push(updated);
      } else if (row.action === 'create') {
        // Imports are the other door into the catalogue, so they hold to the
        // same rule as the product form: a new product's category comes from
        // the managed list (stored with the list's own spelling).
        const category = categoryByLower.get(String(row.category || '').trim().toLowerCase());
        if (!category) {
          throw new Error(
            row.category
              ? `"${row.category}" is not one of the product categories`
              : 'Pick a category for this row'
          );
        }

        const { data: inserted, error: insertErr } = await supabase
          .from('products')
          .insert([
            {
              sku: row.sku,
              name: row.name,
              category,
              description: row.description || null,
              unit_price: row.unit_price,
              stock_quantity: row.quantity || 0,
              availability: row.availability || DEFAULT_AVAILABILITY,
              lead_time_days: row.lead_time_days ?? DEFAULT_LEAD_TIME_DAYS,
              min_order_qty: row.min_order_qty ?? DEFAULT_MIN_ORDER_QTY,
            },
          ])
          .select()
          .single();
        if (insertErr) throw insertErr;
        created.push(inserted);
      }
    } catch (err) {
      errors.push({ row, error: err.message });
    }
  }

  return { restocked, created, errors };
}

module.exports = { matchExtractedRows, confirmProductImport };

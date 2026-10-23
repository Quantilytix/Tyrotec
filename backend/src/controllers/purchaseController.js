const supabase = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const { logForUser } = require('../services/activityLogService');
const { formatCurrency } = require('../utils/formatCurrency');
const { validatePurchaseInput, receivePurchase } = require('../services/stockService');
const { notifyStockArrivalsSoon } = require('../services/waitingOrderService');
const { withSupplierCopies } = require('./productController');
const { assertCategoryAllowed } = require('../services/categoryService');

// Creates the products a purchase's new-product lines describe, with the
// purchase's supplier, the same way the product form does (no stock: the
// purchase adds it). Returns { lines } with product_ids filled in, plus the
// ids created, or { error, status }.
async function createNewProducts(value) {
  const newLines = value.lines.filter((line) => line.new_product);
  if (newLines.length === 0) return { lines: value.lines, createdIds: [] };

  const skus = newLines.map((line) => line.new_product.sku.toLowerCase());
  if (new Set(skus).size !== skus.length) return { error: 'Two new products have the same SKU.', status: 400 };

  const supplier = await withSupplierCopies({ supplier_id: value.supplier_id });
  if (supplier.error) return supplier;

  const rows = [];
  for (const line of newLines) {
    const categoryProblem = await assertCategoryAllowed(line.new_product.category);
    if (categoryProblem) return categoryProblem;
    rows.push({
      ...supplier.fields,
      ...line.new_product,
      vat_applicable: line.vat_rate > 0,
      availability: 'local',
      min_order_qty: 1,
      stock_quantity: 0,
    });
  }

  const { data: created, error } = await supabase.from('products').insert(rows).select('id, sku, name, unit_price');
  if (error) {
    if (error.code === '23505') {
      return { error: 'A product with one of those SKUs already exists. Search for it on the line instead.', status: 400 };
    }
    throw error;
  }

  const idBySku = new Map(created.map((p) => [p.sku.toLowerCase(), p.id]));
  const lines = value.lines.map((line) => {
    if (!line.new_product) return line;
    const { new_product: np, ...rest } = line;
    return { ...rest, product_id: idBySku.get(np.sku.toLowerCase()) };
  });
  return { lines, created, createdIds: created.map((p) => p.id) };
}

const PURCHASE_DETAIL = `
  *,
  supplier:suppliers(id, name, email, phone, location, vat_number, credit_terms_days),
  received_by_user:users!purchases_received_by_fkey(full_name, email),
  purchase_items(id, product_id, quantity, unit_cost, vat_rate, product:products(sku, name))
`;

// Staff. Paginated, newest first. ?supplier_id= and ?search= (supplier invoice number).
const listPurchases = asyncHandler(async (req, res) => {
  const pageNum = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const from = (pageNum - 1) * limitNum;

  let query = supabase
    .from('purchases')
    .select('*, supplier:suppliers(id, name)', { count: 'exact' })
    .order('purchase_date', { ascending: false })
    .order('purchase_number', { ascending: false })
    .range(from, from + limitNum - 1);
  if (req.query.supplier_id) query = query.eq('supplier_id', req.query.supplier_id);
  if (req.query.search) {
    const safe = String(req.query.search).replace(/[,()]/g, '');
    query = query.ilike('supplier_invoice_number', `%${safe}%`);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  return res.json({ data, page: pageNum, limit: limitNum, total: count });
});

const getPurchase = asyncHandler(async (req, res) => {
  const { data, error } = await supabase.from('purchases').select(PURCHASE_DETAIL).eq('id', req.params.id).single();
  if (error || !data) return res.status(404).json({ error: 'Purchase not found' });
  return res.json(data);
});

// Staff. Records goods received: stock goes up and average costs update in
// one step. Purchases can't be edited afterwards; correct mistakes with a
// stock adjustment.
const createPurchase = asyncHandler(async (req, res) => {
  const { value, error: invalid } = validatePurchaseInput(req.body);
  if (invalid) return res.status(400).json({ error: invalid });

  const products = await createNewProducts(value);
  if (products.error) return res.status(products.status).json({ error: products.error });

  const result = await receivePurchase({ ...value, lines: products.lines }, req.user.id);
  if (result.error) {
    // Nothing references the new products yet: take them away again, so a
    // failed purchase leaves no half-made catalogue entries behind.
    if (products.createdIds.length) await supabase.from('products').delete().in('id', products.createdIds);
    return res.status(result.status).json({ error: result.error });
  }
  for (const p of products.created || []) {
    await logForUser(req.user, {
      action: 'product.created',
      entityType: 'product',
      entityId: p.id,
      description: `Added product ${p.name} (${p.sku}) at ${formatCurrency(p.unit_price)} excl. VAT while recording a purchase.`,
    });
  }
  // The new stock may have gone to orders that were waiting for it.
  notifyStockArrivalsSoon();

  const { data } = await supabase.from('purchases').select(PURCHASE_DETAIL).eq('id', result.id).single();
  const units = value.lines.reduce((sum, line) => sum + line.quantity, 0);
  await logForUser(req.user, {
    action: 'purchase.received',
    entityType: 'purchase',
    entityId: result.id,
    description: `Received purchase #${data?.purchase_number ?? ''} from ${data?.supplier?.name ?? 'supplier'} ` +
      `(invoice ${value.supplier_invoice_number}): ${value.lines.length} line(s), ${units} unit(s), ` +
      `${formatCurrency(data?.total_amount ?? 0)} incl. VAT.`,
  });
  return res.status(201).json(data);
});

module.exports = { listPurchases, getPurchase, createPurchase };

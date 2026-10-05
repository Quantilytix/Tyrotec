const supabase = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const { logForUser } = require('../services/activityLogService');
const { formatCurrency } = require('../utils/formatCurrency');
const { notifyIfLowStockCrossing } = require('./productController');
const { validateAdjustmentInput, adjustStock, recordOpeningStock } = require('../services/stockService');

const REASON_LABELS = {
  damaged: 'Damaged',
  lost: 'Lost / stolen',
  count_correction: 'Stock count correction',
  returned_to_supplier: 'Returned to supplier',
  other: 'Other',
};

// Staff. ?product_id= narrows to one product. Newest first, paginated.
const listAdjustments = asyncHandler(async (req, res) => {
  const pageNum = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const from = (pageNum - 1) * limitNum;

  let query = supabase
    .from('stock_adjustments')
    .select('*, product:products(sku, name), created_by_user:users!stock_adjustments_created_by_fkey(full_name, email)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, from + limitNum - 1);
  if (req.query.product_id) query = query.eq('product_id', req.query.product_id);

  const { data, error, count } = await query;
  if (error) throw error;
  return res.json({ data, page: pageNum, limit: limitNum, total: count });
});

// Admin. Damaged, lost, count corrections...: anything that isn't a purchase or a sale.
const createAdjustment = asyncHandler(async (req, res) => {
  const { value, error: invalid } = validateAdjustmentInput(req.body);
  if (invalid) return res.status(400).json({ error: invalid });

  const result = await adjustStock(value, req.user.id);
  if (result.error) return res.status(result.status).json({ error: result.error });

  const { data } = await supabase
    .from('stock_adjustments')
    .select('*, product:products(*)')
    .eq('id', result.id)
    .single();

  if (data?.product) {
    await notifyIfLowStockCrossing(data.stock_before, data.product);
  }
  await logForUser(req.user, {
    action: 'stock.adjusted',
    entityType: 'product',
    entityId: value.product_id,
    description: `Adjusted stock of ${data?.product?.name ?? 'product'} (${data?.product?.sku ?? ''}) by ` +
      `${value.quantity_change > 0 ? '+' : ''}${value.quantity_change} (${REASON_LABELS[value.reason]}): ` +
      `${data?.stock_before} -> ${data?.stock_after}, valued at ${formatCurrency(Math.abs(value.quantity_change) * Number(data?.unit_cost || 0))}` +
      `${value.note ? `. Note: ${value.note}` : ''}.`,
  });

  const { product, ...adjustment } = data || {};
  return res.status(201).json({ ...adjustment, product: product ? { sku: product.sku, name: product.name } : null });
});

// Admin. Whether opening stock has been recorded, and if not, what it would
// include and which products still need a cost first.
const getOpeningStock = asyncHandler(async (req, res) => {
  const { data: recorded, error } = await supabase.from('opening_stock').select('*').maybeSingle();
  if (error) throw error;
  if (recorded) return res.json({ recorded });

  const { data: lines, error: productsError } = await supabase
    .from('products')
    .select('id, sku, name, category, stock_quantity, supplier_cost')
    .gt('stock_quantity', 0)
    .order('sku');
  if (productsError) throw productsError;

  const valued = lines.filter((p) => p.supplier_cost !== null);
  return res.json({
    recorded: null,
    lines,
    missing_cost: lines.filter((p) => p.supplier_cost === null),
    value_so_far: Math.round(valued.reduce((sum, p) => sum + p.stock_quantity * Number(p.supplier_cost), 0) * 100) / 100,
  });
});

// Admin. body: { as_of_date: 'YYYY-MM-DD', costs?: { [product_id]: cost } } — once only.
const createOpeningStock = asyncHandler(async (req, res) => {
  const result = await recordOpeningStock(req.body || {}, req.user.id);
  if (result.error) return res.status(result.status).json({ error: result.error });

  const { data } = await supabase.from('opening_stock').select('*').eq('id', result.id).single();
  await logForUser(req.user, {
    action: 'stock.opening_recorded',
    entityType: 'opening_stock',
    entityId: result.id,
    description: `Recorded opening stock as at ${data?.as_of_date}: ${data?.lines?.length ?? 0} product(s) worth ${formatCurrency(data?.total_value ?? 0)}.`,
  });
  return res.status(201).json(data);
});

module.exports = { listAdjustments, createAdjustment, getOpeningStock, createOpeningStock, REASON_LABELS };

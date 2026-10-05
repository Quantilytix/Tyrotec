const supabase = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const { logForUser } = require('../services/activityLogService');
const { formatCurrency } = require('../utils/formatCurrency');
const { validatePurchaseInput, receivePurchase } = require('../services/stockService');

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

  const result = await receivePurchase(value, req.user.id);
  if (result.error) return res.status(result.status).json({ error: result.error });

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

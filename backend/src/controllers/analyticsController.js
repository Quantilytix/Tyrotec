const supabase = require('../config/supabase');
const { displayTotals } = require('../utils/vat');
const asyncHandler = require('../utils/asyncHandler');

const QUOTE_STATUSES = ['draft', 'submitted', 'converted', 'expired'];
const ORDER_STATUSES = ['pending_approval', 'approved', 'processing', 'completed', 'cancelled'];
const SPEND_EXCLUDED_STATUSES = ['cancelled'];
const DEFAULT_RANGE_DAYS = 30;

function isValidDateString(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).getTime());
}

// Query params are plain YYYY-MM-DD (no time component) -- resolved here
// into an inclusive [fromISO, toExclusiveISO) window so callers never have
// to reason about timestamp edge cases at the end-of-day boundary. Falls
// back to the last 30 days if missing/invalid, matching this endpoint's
// behavior before the date filter existed.
function resolveDateRange(query) {
  const today = new Date().toISOString().slice(0, 10);
  const defaultFrom = new Date(Date.now() - (DEFAULT_RANGE_DAYS - 1) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const from = isValidDateString(query.from) ? query.from : defaultFrom;
  let to = isValidDateString(query.to) ? query.to : today;
  if (to < from) to = from; // swapped/nonsensical range -- collapse to a single day rather than erroring

  const toExclusive = new Date(`${to}T00:00:00.000Z`);
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);

  return { from, to, fromISO: `${from}T00:00:00.000Z`, toExclusiveISO: toExclusive.toISOString() };
}

// Zero-filled so the trend chart shows real gaps instead of skipping days
// with no orders -- an empty day and a missing bucket look identical to a
// caller that just indexes by date.
function datesBetween(from, to) {
  const dates = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

// Admin/sales_rep only. Everything here is aggregated in JS from the raw
// tables (quotes, order_items+products, orders, payments, users+orders) --
// same approach as customerController.js, no Postgres views/RPCs needed for
// this data scale.
const getAnalyticsSummary = asyncHandler(async (req, res) => {
  const { from, to, fromISO, toExclusiveISO } = resolveDateRange(req.query);

  const { data: quotes, error: quotesErr } = await supabase
    .from('quotes')
    .select('status, source, created_at')
    .gte('created_at', fromISO)
    .lt('created_at', toExclusiveISO);
  if (quotesErr) throw quotesErr;

  const counts = QUOTE_STATUSES.reduce((acc, status) => ({ ...acc, [status]: 0 }), {});
  for (const q of quotes) counts[q.status] = (counts[q.status] || 0) + 1;
  const nonDraftTotal = quotes.length - counts.draft;
  const conversionRate = nonDraftTotal > 0 ? counts.converted / nonDraftTotal : 0;

  // orders!inner -- order_items has no created_at of its own; the !inner
  // hint turns this embed into an inner join so the .gte/.lt filters below
  // (which target the embedded orders.created_at) actually restrict which
  // rows come back, not just which columns are attached to each row.
  const { data: orderItems, error: itemsErr } = await supabase
    .from('order_items')
    .select('quantity, unit_price, product_id, products(name, sku, category), orders!inner(created_at)')
    .gte('orders.created_at', fromISO)
    .lt('orders.created_at', toExclusiveISO);
  if (itemsErr) throw itemsErr;

  const productStats = new Map();
  const categoryStats = new Map();
  for (const item of orderItems) {
    const revenue = item.quantity * item.unit_price;

    const product = productStats.get(item.product_id) || {
      product_id: item.product_id,
      name: item.products?.name || 'Unknown product',
      sku: item.products?.sku,
      quantity: 0,
      revenue: 0,
    };
    product.quantity += item.quantity;
    product.revenue += revenue;
    productStats.set(item.product_id, product);

    const categoryKey = item.products?.category || 'uncategorized';
    const category = categoryStats.get(categoryKey) || { category: categoryKey, quantity: 0, revenue: 0 };
    category.quantity += item.quantity;
    category.revenue += revenue;
    categoryStats.set(categoryKey, category);
  }

  const topProducts = [...productStats.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  const topCategories = [...categoryStats.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10);

  const { data: orders, error: ordersErr } = await supabase
    .from('orders')
    .select('status, total_amount, subtotal_amount, vat_amount, created_at, source')
    .gte('created_at', fromISO)
    .lt('created_at', toExclusiveISO);
  if (ordersErr) throw ordersErr;

  const orderCounts = ORDER_STATUSES.reduce((acc, status) => ({ ...acc, [status]: 0 }), {});
  const sellableOrders = orders.filter((o) => !SPEND_EXCLUDED_STATUSES.includes(o.status));
  for (const o of orders) orderCounts[o.status] = (orderCounts[o.status] || 0) + 1;

  // Revenue is reported excluding VAT: the VAT portion is collected on SARS's
  // behalf, not earned. Legacy VAT-inclusive orders have it worked back out
  // (displayTotals), so a period spanning the pricing change still adds up.
  const netOf = (order) => displayTotals(order).subtotal_amount;

  const revenueTotal = sellableOrders.reduce((sum, o) => sum + netOf(o), 0);
  const averageOrderValue = sellableOrders.length > 0 ? revenueTotal / sellableOrders.length : 0;

  const revenueByDate = new Map();
  for (const o of sellableOrders) {
    const date = o.created_at.slice(0, 10);
    revenueByDate.set(date, (revenueByDate.get(date) || 0) + netOf(o));
  }
  const revenueOverTime = datesBetween(from, to).map((date) => ({ date, revenue: revenueByDate.get(date) || 0 }));

  const orderSourceCounts = { portal: 0, whatsapp: 0 };
  for (const o of orders) orderSourceCounts[o.source === 'whatsapp' ? 'whatsapp' : 'portal'] += 1;
  const quoteSourceCounts = { portal: 0, whatsapp: 0 };
  for (const q of quotes) quoteSourceCounts[q.source === 'whatsapp' ? 'whatsapp' : 'portal'] += 1;

  const { data: payments, error: paymentsErr } = await supabase
    .from('payments')
    .select('status, amount, created_at')
    .gte('created_at', fromISO)
    .lt('created_at', toExclusiveISO);
  if (paymentsErr) throw paymentsErr;

  const paymentStats = { collected: { count: 0, amount: 0 }, pendingReview: { count: 0, amount: 0 }, rejected: { count: 0, amount: 0 } };
  const PAYMENT_BUCKET = { approved: 'collected', submitted: 'pendingReview', rejected: 'rejected' };
  for (const p of payments) {
    const bucket = PAYMENT_BUCKET[p.status];
    if (!bucket) continue;
    paymentStats[bucket].count += 1;
    paymentStats[bucket].amount += Number(p.amount || 0);
  }

  // Query itself is NOT date-filtered -- customers.total below stays an
  // all-time count. The embedded orders carry created_at so per-customer
  // spend/order-count (topBySpend/topByOrders) can still be scoped to the
  // selected range, same as every other section.
  const { data: customers, error: custErr } = await supabase
    .from('users')
    .select('id, email, company_name, created_at, orders(status, total_amount, subtotal_amount, vat_amount, created_at)')
    .eq('role', 'customer');
  if (custErr) throw custErr;

  const customerStats = customers.map((c) => {
    const inRangeOrders = (c.orders || []).filter((o) => o.created_at >= fromISO && o.created_at < toExclusiveISO);
    const countedOrders = inRangeOrders.filter((o) => !SPEND_EXCLUDED_STATUSES.includes(o.status));
    return {
      id: c.id,
      email: c.email,
      company_name: c.company_name,
      order_count: inRangeOrders.length,
      // Excl VAT, so top customers tie up with the revenue figures above.
      total_spent: countedOrders.reduce((sum, o) => sum + displayTotals(o).subtotal_amount, 0),
    };
  });

  return res.json({
    range: { from, to },
    quoteFunnel: { counts, conversionRate, total: quotes.length },
    orderFunnel: { counts: orderCounts, total: orders.length },
    revenue: { total: revenueTotal, averageOrderValue },
    revenueOverTime,
    payments: paymentStats,
    sourceBreakdown: { quotes: quoteSourceCounts, orders: orderSourceCounts },
    topProducts,
    topCategories,
    customers: {
      total: customers.length,
      newCustomersInRange: customers.filter((c) => c.created_at >= fromISO && c.created_at < toExclusiveISO).length,
      topBySpend: [...customerStats].sort((a, b) => b.total_spent - a.total_spent).slice(0, 10),
      topByOrders: [...customerStats].sort((a, b) => b.order_count - a.order_count).slice(0, 10),
    },
  });
});

module.exports = { getAnalyticsSummary };

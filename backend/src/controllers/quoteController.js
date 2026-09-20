const supabase = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const { createQuoteForCustomer, convertQuoteForCustomer } = require('../services/quoteService');
const { flagIfNeeded, flagStockShort } = require('../services/adminReviewService');
const { notifyInternalTeam } = require('../services/notificationService');
const { formatCurrency } = require('../utils/formatCurrency');
const { logActivity } = require('../services/activityLogService');
const { friendlyRpcErrorMessage } = require('../utils/rpcErrorMessage');
const { buildQuotesWorkbook, sendWorkbook } = require('../services/exportService');
const { applyDateRange, fetchAllRows } = require('../utils/exportQuery');
const { filterBySearch } = require('../utils/searchFilter');
const { displayTotals } = require('../utils/vat');

const RESERVATION_MINUTES = Number(process.env.RESERVATION_EXPIRY_MINUTES) || 60;

const createQuote = asyncHandler(async (req, res) => {
  const { items } = req.body;
  const customerLabel = req.user.company_name || req.user.email;

  const result = await createQuoteForCustomer(req.user.id, customerLabel, items, 'portal');
  if (result.error) return res.status(result.status).json({ error: result.error });

  return res.status(201).json({ message: 'Quote created successfully', ...result });
});

// Admin/sales_rep only: same pipeline as createQuote, just for a customer
// the staff member picks instead of themselves.
const createQuoteForCustomerAdmin = asyncHandler(async (req, res) => {
  const { customer_id, items } = req.body;

  const { data: customer, error: custErr } = await supabase
    .from('users')
    .select('email, company_name')
    .eq('id', customer_id)
    .eq('role', 'customer')
    .single();
  if (custErr || !customer) return res.status(404).json({ error: 'Customer not found' });

  const customerLabel = customer.company_name || customer.email;
  const result = await createQuoteForCustomer(customer_id, customerLabel, items, 'admin');
  if (result.error) return res.status(result.status).json({ error: result.error });

  return res.status(201).json({ message: 'Quote created successfully', ...result });
});

const getCustomerQuotes = asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('quotes')
    .select('*, quote_items(*, products(name, sku))')
    .eq('customer_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return res.json(data);
});

// Admin/sales_rep only: every customer's quotes.
// Admin/sales_rep only. Two sheets: one row per quote, plus one row per
// product line across those quotes. Optional source and created_at range,
// matching the filters on the admin Quotes screen.
const exportQuotesAdmin = asyncHandler(async (req, res) => {
  const { source, status, search, from, to } = req.query;

  const quotes = await fetchAllRows(() => {
    let query = supabase
      .from('quotes')
      .select('*, users(email, company_name), quote_items(*, products(name, sku))')
      .order('created_at', { ascending: false });

    if (source && source !== 'all') query = query.eq('source', source);
    if (status && status !== 'all') query = query.eq('status', status);
    return applyDateRange(query, { from, to });
  });

  // Search spans the joined customer record, so it's applied here rather than
  // as a database filter -- see utils/searchFilter.js.
  return sendWorkbook(res, buildQuotesWorkbook(filterBySearch(quotes, search, 'quote_number')), 'quotes');
});

const getAllQuotesAdmin = asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('quotes')
    .select('*, users(email, company_name), quote_items(*, products(name, sku))')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return res.json(data);
});

// Admin/sales_rep only. Quotes don't have an approval workflow -- customers
// convert their own submitted quotes to orders -- so the only status change
// staff can make here is voiding a quote that's no longer live.
const updateQuoteStatus = asyncHandler(async (req, res) => {
  const { quoteId: id } = req.params;
  const { status } = req.body;

  if (status !== 'expired') {
    return res.status(400).json({ error: "Status must be 'expired'." });
  }

  const { data: quote, error: findErr } = await supabase
    .from('quotes')
    .select('id, status')
    .eq('id', id)
    .single();

  if (findErr || !quote) return res.status(404).json({ error: 'Quote not found' });

  if (!['draft', 'submitted'].includes(quote.status)) {
    return res.status(400).json({ error: `Quote is already "${quote.status}" and can't be marked expired.` });
  }

  const { error } = await supabase.from('quotes').update({ status: 'expired' }).eq('id', id);
  if (error) throw error;

  return res.json({ message: 'Quote marked as expired', quoteId: id, status: 'expired' });
});

const getQuoteById = asyncHandler(async (req, res) => {
  let query = supabase
    .from('quotes')
    .select('*, users(email, company_name), quote_items(*, products(name, sku))')
    .eq('id', req.params.quoteId);

  if (!['admin', 'sales_rep'].includes(req.user.role)) {
    query = query.eq('customer_id', req.user.id);
  }

  const { data, error } = await query.single();
  if (error || !data) return res.status(404).json({ error: 'Quote not found' });
  return res.json(data);
});

// Customer only -- converts their own submitted quote into an order via the
// existing manual pending_approval path. Staff can no longer convert or
// checkout a quote on a customer's behalf (that capability was deliberately
// removed -- ordering is always the customer's own action now); staff
// creating a quote for a customer (createQuoteForCustomerAdmin) ends with
// handing that customer the quote to act on themselves, not placing the
// order for them. Enforced both here (customerId is always req.user.id,
// never resolved from the quote's actual owner) and at the route
// (requireRole(['customer'])).
const convertQuoteToOrder = asyncHandler(async (req, res) => {
  const { quoteId } = req.params;
  const customerId = req.user.id;
  const customerLabel = req.user.company_name || req.user.email;

  const result = await convertQuoteForCustomer(customerId, customerLabel, quoteId, 'portal');
  if (result.error) return res.status(result.status).json({ error: result.error });

  await logActivity({
    actorId: req.user.id,
    actorLabel: customerLabel,
    action: 'quote.converted',
    entityType: 'order',
    entityId: result.orderId,
    description: `${customerLabel}'s quote #${result.quoteNumber} was converted to order #${result.orderId} via the customer portal.`,
  });

  return res.status(201).json({ message: 'Order created successfully', ...result });
});

// Customer only -- the fast, automated checkout path, sitting alongside
// (not replacing) convertQuoteToOrder above. Runs the atomic stock
// check+reservation transaction (checkout_quote_with_reservation, see
// 014_payfast_checkout_and_review_queue.sql). If every line has enough
// stock, the order is created straight into 'stock_reserved' with the stock
// already decremented and a reservation on the clock; if any line is short,
// the order still gets created, but into the *existing* 'pending_approval'
// state instead -- it falls back into the same manual admin queue that
// already handles that state today, just with an admin_reviews row
// (reason='stock_short') explaining why it's there. This endpoint only
// creates the order -- it never initiates a PayFast payment itself; the
// customer does that as a separate step from the order page.
const checkoutQuoteFast = asyncHandler(async (req, res) => {
  const { quoteId } = req.params;

  const { data: rows, error } = await supabase.rpc('checkout_quote_with_reservation', {
    p_quote_id: quoteId,
    p_customer_id: req.user.id,
    p_reservation_minutes: RESERVATION_MINUTES,
  });

  if (error) return res.status(400).json({ error: friendlyRpcErrorMessage(error.message) });

  const result = rows?.[0];
  if (!result) return res.status(500).json({ error: 'Checkout did not return a result.' });

  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select('order_number, total_amount, subtotal_amount, vat_amount')
    .eq('id', result.order_id)
    .single();
  if (orderErr || !order) throw orderErr || new Error('Order not found after checkout');

  const customerLabel = req.user.company_name || req.user.email;

  // Three independent writes (admin_reviews, notifications+email, activity_log)
  // -- run concurrently rather than serializing them on the checkout path
  // this whole fast-checkout feature exists to keep snappy.
  if (result.order_status === 'stock_reserved') {
    await Promise.all([
      // The review threshold is a value-of-goods rule, so it compares the
      // excl-VAT amount -- otherwise adding 15% would start tripping reviews
      // on orders the client considers below the limit.
      flagIfNeeded(result.order_id, req.user.id, displayTotals(order).subtotal_amount),
      notifyInternalTeam({
        type: 'general',
        title: 'Fast checkout: stock reserved',
        message: `${customerLabel} reserved stock for order #${order.order_number} (${formatCurrency(order.total_amount)}) and can now pay via PayFast.`,
        relatedType: 'order',
        relatedId: result.order_id,
      }),
      logActivity({
        actorId: req.user.id,
        actorLabel: customerLabel,
        action: 'quote.converted',
        entityType: 'order',
        entityId: result.order_id,
        description: `${customerLabel} used fast checkout to create order #${order.order_number} (${formatCurrency(order.total_amount)}); stock reserved, awaiting PayFast payment.`,
      }),
    ]);
  } else {
    await Promise.all([
      flagStockShort(result.order_id),
      notifyInternalTeam({
        type: 'general',
        title: 'Fast checkout: stock shortfall',
        message: `${customerLabel}'s fast checkout for order #${order.order_number} hit insufficient stock and needs manual review.`,
        relatedType: 'order',
        relatedId: result.order_id,
      }),
      logActivity({
        actorId: req.user.id,
        actorLabel: customerLabel,
        action: 'quote.converted',
        entityType: 'order',
        entityId: result.order_id,
        description: `${customerLabel}'s fast checkout for order #${order.order_number} hit a stock shortfall and fell back to manual review.`,
      }),
    ]);
  }

  return res.status(201).json({
    orderId: result.order_id,
    orderNumber: order.order_number,
    status: result.order_status,
    shortProductId: result.short_product_id,
    shortRequested: result.short_requested,
    shortAvailable: result.short_available,
  });
});

module.exports = {
  createQuote,
  createQuoteForCustomerAdmin,
  getCustomerQuotes,
  getAllQuotesAdmin,
  exportQuotesAdmin,
  getQuoteById,
  updateQuoteStatus,
  convertQuoteToOrder,
  checkoutQuoteFast,
};

const supabase = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const { notifyUser } = require('../services/notificationService');
const { notifyIfLowStockCrossing } = require('./productController');
const { transitionOrderStatus, ORDER_TRANSITIONS } = require('../services/orderStateService');
const { buildCheckoutFields } = require('../services/payfastService');
const { buildOrdersWorkbook, sendWorkbook } = require('../services/exportService');
const { applyDateRange, fetchAllRows } = require('../utils/exportQuery');
const { filterBySearch } = require('../utils/searchFilter');
const { logActivity } = require('../services/activityLogService');
const { friendlyRpcErrorMessage } = require('../utils/rpcErrorMessage');

// Adds a server-computed seconds_remaining to each stock_reservations row,
// alongside the raw expires_at. The frontend's countdown used to compare
// expires_at directly against the customer's own device clock -- which
// looks "already expired" the instant a reservation is created whenever
// that device's clock disagrees with real time (wrong timezone, no NTP
// sync, a phone that's just plain wrong -- all common). Computing the
// remaining time here, on this one server clock, and shipping a plain
// relative number instead of an absolute timestamp means the frontend never
// needs to trust the client's own clock at all -- it just counts this
// number down locally.
function withReservationSecondsRemaining(order) {
  if (!order?.stock_reservations) return order;
  const nowMs = Date.now();
  return {
    ...order,
    stock_reservations: order.stock_reservations.map((r) => ({
      ...r,
      seconds_remaining: Math.max(0, Math.round((new Date(r.expires_at).getTime() - nowMs) / 1000)),
    })),
  };
}

// What a human can pick from the admin status dropdown. Deliberately
// excludes 'stock_reserved' (only ever set by checkout_quote_with_reservation
// at order creation) and 'confirmed' (only ever set by the verified PayFast
// webhook in payfastWebhookController.js -- an admin clicking a dropdown is
// exactly the kind of untrusted client-side trigger that state is supposed
// to never come from). 'ready_for_collection' stays reachable here since
// marking fulfillment ready is a legitimate manual staff action.
const ORDER_STATUSES = ['pending_approval', 'approved', 'processing', 'completed', 'cancelled', 'ready_for_collection'];

const STATUS_NOTIFICATIONS = {
  approved: (orderNumber) => ({
    title: 'Order approved',
    message: `Good news, your order #${orderNumber} has been approved. Submit your payment details on the Customer Portal or via WhatsApp ("Submit a payment" from the main menu).`,
  }),
  cancelled: (orderNumber) => ({
    title: 'Order cancelled',
    message: `Unfortunately, your order #${orderNumber} has been cancelled. Contact us if you have any questions.`,
  }),
  processing: (orderNumber) => ({
    title: 'Order in progress',
    message: `Your order #${orderNumber} is now being processed.`,
  }),
  completed: (orderNumber) => ({
    title: 'Order completed',
    message: `Your order #${orderNumber} has been completed.`,
  }),
  ready_for_collection: (orderNumber) => ({
    title: 'Order ready for collection',
    message: `Your order #${orderNumber} is ready for collection.`,
  }),
};

const getCustomerOrders = asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('orders')
    .select('*, order_items(*, products(name, sku)), payments(*)')
    .eq('customer_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return res.json(data);
});

const getAllOrdersAdmin = asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('orders')
    .select('*, users(email, company_name), order_items(*)')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return res.json(data);
});

// Admin/sales_rep only. Two sheets: one row per order, plus one row per
// product line across those orders. Optional source and created_at range,
// matching the filters on the admin Orders screen.
const exportOrdersAdmin = asyncHandler(async (req, res) => {
  const { source, status, search, from, to } = req.query;

  const orders = await fetchAllRows(() => {
    let query = supabase
      .from('orders')
      .select('*, users(email, company_name), order_items(*, products(name, sku)), payments(*)')
      .order('created_at', { ascending: false });

    if (source && source !== 'all') query = query.eq('source', source);
    if (status && status !== 'all') query = query.eq('status', status);
    return applyDateRange(query, { from, to });
  });

  // Search spans the joined customer record, so it's applied here rather than
  // as a database filter -- see utils/searchFilter.js.
  return sendWorkbook(res, buildOrdersWorkbook(filterBySearch(orders, search, 'order_number')), 'orders');
});

const getOrderById = asyncHandler(async (req, res) => {
  let query = supabase
    .from('orders')
    .select('*, order_items(*, products(name, sku)), users(email, company_name, full_name, phone, vat_number, address), payments(*), stock_reservations(expires_at)')
    .eq('id', req.params.id);

  if (!['admin', 'sales_rep'].includes(req.user.role)) {
    query = query.eq('customer_id', req.user.id);
  }

  const { data, error } = await query.single();
  if (error || !data) return res.status(404).json({ error: 'Order not found' });
  return res.json(withReservationSecondsRemaining(data));
});

// Admin/sales_rep only. Approval and cancellation run through Postgres functions
// that atomically manage stock (decrement on approval, restock on cancellation).
const updateOrderStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!ORDER_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${ORDER_STATUSES.join(', ')}` });
  }

  const { data: order, error: findErr } = await supabase
    .from('orders')
    .select('id, order_number, status, customer_id, users(email, company_name, phone)')
    .eq('id', id)
    .single();

  if (findErr || !order) return res.status(404).json({ error: 'Order not found' });

  if (!ORDER_TRANSITIONS[order.status]?.includes(status)) {
    return res.status(400).json({
      error: `Cannot move order from "${order.status}" to "${status}".`,
    });
  }

  if (status === 'approved') {
    // approve_order decrements stock for every item on this order. Snapshot
    // stock before, and check for a low-stock crossing on each affected
    // product after, since this Postgres function is the other place
    // (besides a direct product edit) stock_quantity actually changes.
    const { data: items } = await supabase.from('order_items').select('product_id').eq('order_id', id);
    const productIds = [...new Set((items || []).map((i) => i.product_id))];

    const { data: beforeProducts } = await supabase
      .from('products')
      .select('id, stock_quantity')
      .in('id', productIds);
    const previousStockById = new Map((beforeProducts || []).map((p) => [p.id, p.stock_quantity]));

    const { error } = await supabase.rpc('approve_order', { p_order_id: id });
    if (error) return res.status(400).json({ error: friendlyRpcErrorMessage(error.message) });

    const { data: afterProducts } = await supabase
      .from('products')
      .select('id, sku, name, stock_quantity')
      .in('id', productIds);
    await Promise.all((afterProducts || []).map((product) => notifyIfLowStockCrossing(previousStockById.get(product.id), product)));
  } else if (status === 'cancelled') {
    const { error } = await supabase.rpc('cancel_order', { p_order_id: id });
    if (error) return res.status(400).json({ error: friendlyRpcErrorMessage(error.message) });
  } else {
    // e.g. 'processing', 'completed', 'ready_for_collection' -- plain status
    // moves with no stock side effect, routed through the single
    // transitionOrderStatus() function (orderStateService.js) that every
    // other orders.status write in the app now goes through too.
    const result = await transitionOrderStatus(id, status);
    if (result.error) return res.status(result.status).json({ error: result.error });
  }

  const { title, message } = STATUS_NOTIFICATIONS[status]?.(order.order_number) || {
    title: 'Order status updated',
    message: `Your order #${order.order_number} is now "${status.replace('_', ' ')}".`,
  };

  // Independent writes to unrelated tables -- run concurrently rather than
  // paying for two sequential round-trips.
  await Promise.all([
    notifyUser({
      userId: order.customer_id,
      type: 'order_status_changed',
      title,
      message,
      relatedType: 'order',
      relatedId: id,
      email: order.users?.email,
      phone: order.users?.phone,
    }),
    logActivity({
      actorId: req.user.id,
      actorLabel: req.user.company_name || req.user.email,
      action: 'order.status_changed',
      entityType: 'order',
      entityId: id,
      description: `${req.user.company_name || req.user.email} changed order #${order.order_number} from "${order.status}" to "${status}".`,
    }),
  ]);

  return res.json({ message: 'Order status updated', orderId: id, status });
});

// Customer only. Order must be theirs and already 'stock_reserved' (set by
// checkout_quote_with_reservation) -- there's no PayFast payment possible
// for an order still sitting in the manual pending_approval queue.
const initiatePayfastPayment = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const { data: order, error } = await supabase
    .from('orders')
    .select('id, order_number, status, total_amount, customer_id, users(email, company_name)')
    .eq('id', id)
    .eq('customer_id', req.user.id)
    .single();

  if (error || !order) return res.status(404).json({ error: 'Order not found' });
  if (order.status !== 'stock_reserved') {
    return res.status(400).json({ error: 'This order is not awaiting PayFast payment.' });
  }

  const checkout = buildCheckoutFields(order, order.users || {});

  return res.json(checkout);
});

// Lean, poll-friendly status lookup -- same ownership scoping as
// getOrderById (staff see any order, customers only their own) but without
// the full item/payment payload.
const getOrderStatus = asyncHandler(async (req, res) => {
  let query = supabase
    .from('orders')
    .select('id, order_number, status, total_amount, updated_at, stock_reservations(expires_at), payments(status, gateway, gateway_status)')
    .eq('id', req.params.orderId);

  if (!['admin', 'sales_rep'].includes(req.user.role)) {
    query = query.eq('customer_id', req.user.id);
  }

  const { data, error } = await query.single();
  if (error || !data) return res.status(404).json({ error: 'Order not found' });
  return res.json(withReservationSecondsRemaining(data));
});

module.exports = {
  getCustomerOrders,
  getAllOrdersAdmin,
  exportOrdersAdmin,
  getOrderById,
  updateOrderStatus,
  initiatePayfastPayment,
  getOrderStatus,
};

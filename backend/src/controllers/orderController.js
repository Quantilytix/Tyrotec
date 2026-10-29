const supabase = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const { isStaff } = require('../utils/roles');
const { notifyUser, notifyInternalTeam, sendEmailOrThrow } = require('../services/notificationService');
const { generateInvoicePdfBuffer } = require('../services/quotePdfService');
const { invoiceLabel, saleLabel } = require('../utils/invoiceNumber');
const { displayTotals } = require('../utils/vat');
const { notifyIfLowStockCrossing } = require('./productController');
const { transitionOrderStatus, ORDER_TRANSITIONS } = require('../services/orderStateService');
const { buildCheckoutFields } = require('../services/payfastService');
const { buildOrdersWorkbook, sendWorkbook } = require('../services/exportService');
const { applyDateRange, fetchAllRows } = require('../utils/exportQuery');
const { filterBySearch } = require('../utils/searchFilter');
const { logActivity, logForUser } = require('../services/activityLogService');
const { friendlyRpcErrorMessage } = require('../utils/rpcErrorMessage');
const { dbNowMs } = require('../utils/dbClock');
const { formatCurrency } = require('../utils/formatCurrency');
const { setStockEta, notifyStockArrivalsSoon } = require('../services/waitingOrderService');

// Adds a seconds_remaining to each stock_reservations row, alongside the raw
// expires_at, so the frontend counts down a plain relative number instead of
// comparing an absolute timestamp against the customer's own device clock --
// which looks "already expired" the moment a reservation is created whenever
// that device's clock is wrong (bad timezone, no NTP sync, a phone that's
// just plain wrong -- all common).
//
// The subtraction uses the *database* clock, not this process's. expires_at
// was written by Postgres (now() + interval) and release_expired_
// reservations() decides what has lapsed against now() as well, so the
// database is the only clock that governs this deadline. Using Date.now()
// here meant a host whose clock ran fast reported every fresh reservation as
// expired -- an hour-fast dev machine made fast checkout unusable while
// production, with a correct clock, was fine.
async function withReservationSecondsRemaining(order) {
  if (!order?.stock_reservations) return order;
  const nowMs = await dbNowMs();
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

// Orders a customer can pay online: their stock is already set aside.
const PAYFAST_PAYABLE_STATUSES = ['stock_reserved', 'approved'];

// name: "order #57" or "invoice INV-0003" (saleLabel); kind: "Order"/"Invoice".
const STATUS_NOTIFICATIONS = {
  approved: (name, kind) => ({
    title: `${kind} approved`,
    message: `Good news, your ${name} has been approved. Pay now on the Customer Portal with PayFast (card or Instant EFT).`,
  }),
  cancelled: (name, kind) => ({
    title: `${kind} cancelled`,
    message: `Unfortunately, your ${name} has been cancelled. Contact us if you have any questions.`,
  }),
  processing: (name, kind) => ({
    title: `${kind} in progress`,
    message: `Your ${name} is now being processed.`,
  }),
  completed: (name, kind) => ({
    title: `${kind} completed`,
    message: `Your ${name} has been completed.`,
  }),
  ready_for_collection: (name, kind) => ({
    title: `${kind} ready for collection`,
    message: `Your ${name} is ready for collection.`,
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

// ?kind=invoices: staff-made sales (they have an invoice number, 042);
// ?kind=orders: what customers placed themselves on the portal or WhatsApp.
function filterByKind(query, kind) {
  if (kind === 'invoices') return query.not('invoice_number', 'is', null);
  if (kind === 'orders') return query.is('invoice_number', null);
  return query;
}

const getAllOrdersAdmin = asyncHandler(async (req, res) => {
  const query = supabase
    .from('orders')
    .select('*, users(email, company_name), order_items(*), payments(amount, status)')
    .order('created_at', { ascending: false });

  const { data, error } = await filterByKind(query, req.query.kind);
  if (error) throw error;
  return res.json(data);
});

// Admin/sales_rep only. Two sheets: one row per order, plus one row per
// product line across those orders. Optional source and created_at range,
// matching the filters on the admin Orders screen.
const exportOrdersAdmin = asyncHandler(async (req, res) => {
  const { source, status, search, from, to, kind } = req.query;

  const orders = await fetchAllRows(() => {
    let query = filterByKind(
      supabase
        .from('orders')
        .select('*, users(email, company_name), order_items(*, products(name, sku)), payments(*)')
        .order('created_at', { ascending: false }),
      kind
    );

    if (source && source !== 'all') query = query.eq('source', source);
    if (status && status !== 'all') query = query.eq('status', status);
    return applyDateRange(query, { from, to });
  });

  // Search spans the joined customer record, so it's applied here rather than
  // as a database filter -- see utils/searchFilter.js. Invoices are searched
  // by their INV- number, the one on screen.
  const invoices = kind === 'invoices';
  const rows = invoices
    ? filterBySearch(orders.map((o) => ({ ...o, invoice_ref: invoiceLabel(o.invoice_number) })), search, 'invoice_ref')
    : filterBySearch(orders, search, 'order_number');
  const noun = invoices ? 'invoice' : 'order';

  await logForUser(req.user, {
    action: 'data.exported',
    entityType: 'orders',
    description: `Exported ${rows.length} ${noun}(s) to Excel${status && status !== 'all' ? ` (status: ${status})` : ''}${from || to ? ` (${from || 'start'} to ${to || 'today'})` : ''}.`,
  });

  return sendWorkbook(res, buildOrdersWorkbook(rows), `${noun}s`);
});

const getOrderById = asyncHandler(async (req, res) => {
  let query = supabase
    .from('orders')
    .select('*, order_items(*, products(name, sku, stock_quantity, lead_time_days)), users(email, company_name, full_name, phone, vat_number, address), payments(*), stock_reservations(expires_at)')
    .eq('id', req.params.id);

  if (!isStaff(req.user.role)) {
    query = query.eq('customer_id', req.user.id);
  }

  const { data, error } = await query.single();
  if (error || !data) return res.status(404).json({ error: 'Order not found' });
  return res.json(await withReservationSecondsRemaining(data));
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
    .select('id, order_number, invoice_number, status, customer_id, users(email, company_name, phone)')
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
    // Stock it returned may have gone to orders that were waiting for it.
    notifyStockArrivalsSoon();
  } else {
    // e.g. 'processing', 'completed', 'ready_for_collection' -- plain status
    // moves with no stock side effect, routed through the single
    // transitionOrderStatus() function (orderStateService.js) that every
    // other orders.status write in the app now goes through too.
    const result = await transitionOrderStatus(id, status);
    if (result.error) return res.status(result.status).json({ error: result.error });
  }

  const kind = order.invoice_number ? 'Invoice' : 'Order';
  const { title, message } = STATUS_NOTIFICATIONS[status]?.(saleLabel(order), kind) || {
    title: `${kind} status updated`,
    message: `Your ${saleLabel(order)} is now "${status.replace('_', ' ')}".`,
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
      actorRole: req.user.role,
      actorLabel: req.user.company_name || req.user.email,
      action: 'order.status_changed',
      entityType: 'order',
      entityId: id,
      description: `${req.user.company_name || req.user.email} changed order #${order.order_number} from "${order.status}" to "${status}".`,
    }),
  ]);

  return res.json({ message: 'Order status updated', orderId: id, status });
});

// Customer only. Order must be theirs and have its stock set aside: reserved
// at checkout ('stock_reserved'), or approved by staff or when stock it was
// waiting for arrived ('approved'). There's no PayFast payment possible for
// an order still sitting in the pending_approval queue.
const initiatePayfastPayment = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const { data: order, error } = await supabase
    .from('orders')
    .select('id, order_number, invoice_number, status, total_amount, customer_id, users(email, company_name), order_items(quantity, products(name))')
    .eq('id', id)
    .eq('customer_id', req.user.id)
    .single();

  if (error || !order) return res.status(404).json({ error: 'Order not found' });
  if (!PAYFAST_PAYABLE_STATUSES.includes(order.status)) {
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

  if (!isStaff(req.user.role)) {
    query = query.eq('customer_id', req.user.id);
  }

  const { data, error } = await query.single();
  if (error || !data) return res.status(404).json({ error: 'Order not found' });
  return res.json(await withReservationSecondsRemaining(data));
});

// Customer only: be invoiced for this order instead of paying online.
//
// Offered on the order rather than at checkout, so every customer takes one
// route to get here and only then chooses how to settle it. The RPC drops
// the stock reservation (without restoring the stock -- the goods stay
// committed) so no expiry timer applies to an invoice.
const payOnInvoice = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!req.user.can_order_on_account) {
    return res.status(403).json({ error: 'This account is not set up to pay on invoice.' });
  }

  const { data: rows, error } = await supabase.rpc('switch_order_to_invoice', {
    p_order_id: id,
    p_customer_id: req.user.id,
  });
  if (error) return res.status(400).json({ error: friendlyRpcErrorMessage(error.message) });

  const { data: order } = await supabase
    .from('orders')
    .select('order_number, total_amount')
    .eq('id', id)
    .single();

  const customerLabel = req.user.company_name || req.user.email;
  await Promise.all([
    notifyInternalTeam({
      type: 'general',
      title: 'Order to be invoiced',
      message: `${customerLabel} chose to be invoiced for order #${order?.order_number} (${formatCurrency(order?.total_amount)}). Record the payment once it reflects.`,
      relatedType: 'order',
      relatedId: id,
    }),
    logForUser(req.user, {
      action: 'order.status_changed',
      entityType: 'order',
      entityId: id,
      description: `${customerLabel} chose to pay order #${order?.order_number} on invoice.`,
    }),
  ]);

  return res.json({ orderId: id, status: rows?.[0]?.order_status || 'awaiting_payment' });
});

// Staff only. Tells the customer of an order waiting for stock when it
// should arrive, as a number of days from today.
const updateStockEta = asyncHandler(async (req, res) => {
  const result = await setStockEta(req.params.id, Number(req.body.days), req.user);
  if (result.error) return res.status(result.status).json({ error: result.error });
  return res.json(result);
});

// An invoice with everything its PDF needs. Staff see any; a customer only
// their own. Null when there is no such invoice (or it's a plain order).
async function loadInvoice(id, user) {
  let query = supabase
    .from('orders')
    .select('*, order_items(*, products(name, sku)), users(email, company_name, full_name, phone, vat_number, address), payments(amount, status)')
    .eq('id', id);
  if (!isStaff(user.role)) query = query.eq('customer_id', user.id);
  const { data } = await query.maybeSingle();
  return data?.invoice_number ? data : null;
}

// Staff and the invoice's customer. The tax invoice PDF.
const getInvoicePdf = asyncHandler(async (req, res) => {
  const invoice = await loadInvoice(req.params.id, req.user);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  const pdf = generateInvoicePdfBuffer({ order: invoice, items: invoice.order_items, customer: invoice.users });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${invoiceLabel(invoice.invoice_number)}.pdf"`);
  return res.send(pdf);
});

// Staff only. Emails the tax invoice PDF to the customer.
const emailInvoice = asyncHandler(async (req, res) => {
  const invoice = await loadInvoice(req.params.id, req.user);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  const customer = invoice.users || {};
  if (!customer.email) return res.status(400).json({ error: 'This customer has no email address on file.' });

  const number = invoiceLabel(invoice.invoice_number);
  const total = formatCurrency(displayTotals(invoice).total_amount);
  const customerLabel = customer.company_name || customer.full_name || customer.email;
  const body = [
    `Hi ${customerLabel},`,
    '',
    `Please find attached tax invoice ${number} for ${total} (incl. VAT).`,
    '',
    `You can view it and pay online by signing in to the Tyrotec Customer Portal. If you pay by EFT, please use ${number} as the reference.`,
    '',
    'Kind regards,',
    'Tyrotec',
  ].join('\n');

  try {
    await sendEmailOrThrow(customer.email, `Your tax invoice ${number} from Tyrotec`, body, {
      attachments: [{ filename: `${number}.pdf`, content: generateInvoicePdfBuffer({ order: invoice, items: invoice.order_items, customer }) }],
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  await Promise.all([
    notifyUser({
      userId: invoice.customer_id,
      type: 'general',
      title: `Invoice ${number} sent`,
      message: `We've emailed you tax invoice ${number} for ${total}.`,
      relatedType: 'order',
      relatedId: invoice.id,
    }),
    logForUser(req.user, {
      action: 'invoice.emailed',
      entityType: 'order',
      entityId: invoice.id,
      description: `${req.user.company_name || req.user.email} emailed tax invoice ${number} to ${customer.email}.`,
    }),
  ]);

  return res.json({ sent: true, to: customer.email, invoiceNumber: number });
});

module.exports = {
  getInvoicePdf,
  emailInvoice,
  updateStockEta,
  payOnInvoice,
  getCustomerOrders,
  getAllOrdersAdmin,
  exportOrdersAdmin,
  getOrderById,
  updateOrderStatus,
  initiatePayfastPayment,
  getOrderStatus,
};

// Orders waiting for stock (037_orders_waiting_for_stock.sql explains the
// flow). The database decides who gets stock and when; this file does what
// plpgsql can't: tell people.
//
//  - setStockEta: staff tell the customer when the stock should arrive.
//  - notifyStockArrivals: tells customers whose waiting order was just given
//    stock that they can pay, and by when.
//  - cancelOverdueUnpaidOrders: cancels approved orders not paid by their
//    deadline and tells the customer.

const supabase = require('../config/supabase');
const { notifyUser, notifyInternalTeam } = require('./notificationService');
const { logActivity, logForUser } = require('./activityLogService');
const { formatCurrency } = require('../utils/formatCurrency');
const { saleLabel } = require('../utils/invoiceNumber');

const TIMEZONE = 'Africa/Johannesburg';
const MAX_ETA_DAYS = 365;

// Today in South Africa plus `days`, as 'YYYY-MM-DD'.
function expectedDate(days, now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// 'YYYY-MM-DD' or a timestamp, as "28 Oct 2026" in South African time.
function formatDay(value) {
  if (!value) return '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return new Intl.DateTimeFormat('en-ZA', { timeZone: TIMEZONE, day: 'numeric', month: 'short', year: 'numeric' })
    .format(date);
}

async function setStockEta(orderId, days, user) {
  if (!Number.isInteger(days) || days < 0 || days > MAX_ETA_DAYS) {
    return { error: `Enter a number of days from 0 to ${MAX_ETA_DAYS}.`, status: 400 };
  }

  const { data: order, error: findErr } = await supabase
    .from('orders')
    .select('id, order_number, invoice_number, status, customer_id, users(email, phone)')
    .eq('id', orderId)
    .single();
  if (findErr || !order) return { error: 'Order not found', status: 404 };
  if (order.status !== 'pending_approval') {
    return { error: 'Only an order waiting for approval can be given an arrival date.', status: 400 };
  }

  const date = expectedDate(days);
  const { error } = await supabase.from('orders').update({ stock_expected_at: date }).eq('id', orderId);
  if (error) throw error;

  await Promise.all([
    notifyUser({
      userId: order.customer_id,
      type: 'order_status_changed',
      title: 'When your stock will arrive',
      message: `The items on your ${saleLabel(order)} are expected around ${formatDay(date)}. We'll let you know as soon as they arrive so you can pay.`,
      relatedType: 'order',
      relatedId: orderId,
      email: order.users?.email,
      phone: order.users?.phone,
    }),
    logForUser(user, {
      action: 'order.stock_eta_set',
      entityType: 'order',
      entityId: orderId,
      description: `Told the customer the stock for order #${order.order_number} should arrive around ${formatDay(date)} (${days} day(s)).`,
    }),
  ]);

  return { orderId, stockExpectedAt: date };
}

// Claims every order the database gave stock to since the last call, so each
// customer is told once even if two calls overlap.
async function notifyStockArrivals() {
  const { data: claimed, error } = await supabase
    .from('orders')
    .update({ allocation_notified_at: new Date().toISOString() })
    .not('allocated_at', 'is', null)
    .is('allocation_notified_at', null)
    .select('id, order_number, invoice_number, customer_id, total_amount, payment_due_at');
  if (error) throw error;
  if (!claimed || claimed.length === 0) return [];

  const { data: customers } = await supabase
    .from('users')
    .select('id, email, phone')
    .in('id', [...new Set(claimed.map((o) => o.customer_id))]);
  const customerById = new Map((customers || []).map((c) => [c.id, c]));

  for (const order of claimed) {
    const customer = customerById.get(order.customer_id);
    const due = order.payment_due_at ? ` Please pay by ${formatDay(order.payment_due_at)}; after that the stock goes to the next customer.` : '';
    await Promise.all([
      notifyUser({
        userId: order.customer_id,
        type: 'order_status_changed',
        title: 'Your stock has arrived',
        message: `Good news: the items on your ${saleLabel(order)} have arrived and are set aside for you. Pay now on the Customer Portal with PayFast (card or Instant EFT).${due}`,
        relatedType: 'order',
        relatedId: order.id,
        email: customer?.email,
        phone: customer?.phone,
      }),
      notifyInternalTeam({
        type: 'general',
        title: 'Stock given to a waiting order',
        message: `Order #${order.order_number} (${formatCurrency(order.total_amount)}) was waiting for stock and has been approved automatically now that it's in. Awaiting payment.`,
        relatedType: 'order',
        relatedId: order.id,
      }),
      logActivity({
        actorLabel: 'Stock allocation (automated)',
        action: 'order.status_changed',
        entityType: 'order',
        entityId: order.id,
        description: `Stock arrived for order #${order.order_number}; it moved from "pending_approval" to "approved" and the customer has until ${formatDay(order.payment_due_at)} to pay.`,
      }),
    ]);
  }
  return claimed.map((o) => o.id);
}

async function cancelOverdueUnpaidOrders() {
  const { data: rows, error } = await supabase.rpc('cancel_overdue_unpaid_orders');
  if (error) throw error;
  const orderIds = (rows || []).map((r) => r.order_id);
  if (orderIds.length === 0) return [];

  const { data: orders, error: ordersErr } = await supabase
    .from('orders')
    .select('id, order_number, customer_id, payment_due_at, users(email, phone)')
    .in('id', orderIds);
  if (ordersErr) throw ordersErr;

  for (const order of orders || []) {
    await Promise.all([
      notifyUser({
        userId: order.customer_id,
        type: 'order_status_changed',
        title: 'Order cancelled: not paid in time',
        message: `Your order #${order.order_number} was cancelled because payment wasn't received by ${formatDay(order.payment_due_at)}, and its stock has been released. Request a new quote if you still need these items.`,
        relatedType: 'order',
        relatedId: order.id,
        email: order.users?.email,
        phone: order.users?.phone,
      }),
      logActivity({
        actorLabel: 'Payment deadline (automated)',
        action: 'order.status_changed',
        entityType: 'order',
        entityId: order.id,
        description: `Order #${order.order_number} was not paid by ${formatDay(order.payment_due_at)}; it moved from "approved" to "cancelled" and its stock was released.`,
      }),
    ]);
  }
  return orderIds;
}

// For callers that just changed stock: tell anyone who got some, without
// holding up or failing the caller's own response.
function notifyStockArrivalsSoon() {
  notifyStockArrivals().catch((err) => console.error('Could not send stock-arrival notices:', err.message || err));
}

module.exports = {
  expectedDate,
  formatDay,
  setStockEta,
  notifyStockArrivals,
  notifyStockArrivalsSoon,
  cancelOverdueUnpaidOrders,
  MAX_ETA_DAYS,
};

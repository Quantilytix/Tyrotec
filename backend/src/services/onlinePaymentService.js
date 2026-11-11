const supabase = require('../config/supabase');
const { transitionOrderStatus } = require('./orderStateService');
const { notifyUser, notifyInternalTeam } = require('./notificationService');
const { logActivity } = require('./activityLogService');
const { CURRENCY, toCents, metadataOf } = require('./paystackService');
const { saleLabel } = require('../utils/invoiceNumber');
const { formatCurrency } = require('../utils/formatCurrency');

// Orders a customer can pay online: stock set aside at checkout
// ('stock_reserved'), approved (by staff, or when the stock it waited for
// arrived), or invoiced and waiting for payment ('awaiting_payment'). The
// same three a staff member can record a payment against.
const ONLINE_PAYABLE_STATUSES = ['stock_reserved', 'approved', 'awaiting_payment'];

const ACTOR = 'Paystack (automated)';

// Records a Paystack transaction against its order and, when it is a full
// payment for an order still waiting for one, marks the order paid.
//
// `tx` must come from paystackService.verifyTransaction -- fetched from
// Paystack with the secret key -- never from a request body. Called from
// both the webhook and the customer's return to the portal; whichever comes
// second finds the payment already there and changes nothing.
//
// Returns { outcome }:
//   'paid'          recorded, order confirmed (or it already was)
//   'needs_review'  money was taken but something doesn't add up (paid too
//                   little, the order was cancelled meanwhile, already paid
//                   another way); recorded as 'submitted' and staff told
//   'not_paid'      Paystack says it didn't go through (abandoned, failed,
//                   still pending): nothing is written
//   'unknown_order' not one of ours
async function recordPaystackTransaction(tx) {
  const orderId = metadataOf(tx).order_id;
  if (!orderId) return { outcome: 'unknown_order' };

  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select('id, order_number, invoice_number, status, total_amount, customer_id, users(email, phone, company_name)')
    .eq('id', orderId)
    .maybeSingle();
  if (orderErr) throw orderErr;
  if (!order) return { outcome: 'unknown_order' };

  if (tx.status !== 'success') return { outcome: 'not_paid', order, gatewayStatus: tx.status };

  const { data: existing, error: existingErr } = await supabase
    .from('payments')
    .select('id, status')
    .eq('gateway_reference', tx.reference)
    .maybeSingle();
  if (existingErr) throw existingErr;
  if (existing) {
    return { outcome: existing.status === 'approved' ? 'paid' : 'needs_review', order, alreadyRecorded: true };
  }

  const { data: otherPayments, error: otherErr } = await supabase
    .from('payments')
    .select('id')
    .eq('order_id', orderId)
    .in('status', ['submitted', 'approved']);
  if (otherErr) throw otherErr;

  const amountPaid = tx.amount / 100;
  const problem =
    tx.currency !== CURRENCY
      ? `it was paid in ${tx.currency}, not ${CURRENCY}`
      : tx.amount < toCents(order.total_amount)
        ? `only ${formatCurrency(amountPaid)} of ${formatCurrency(order.total_amount)} was paid`
        : !ONLINE_PAYABLE_STATUSES.includes(order.status)
          ? `the order is "${order.status.replace(/_/g, ' ')}", so it wasn't waiting for a payment`
          : otherPayments.length > 0
            ? 'it already had a payment recorded'
            : null;

  const now = new Date().toISOString();
  const { error: insertErr } = await supabase.from('payments').insert([
    {
      order_id: orderId,
      customer_id: order.customer_id,
      method: 'paystack',
      reference: tx.reference,
      amount: amountPaid,
      gateway: 'paystack',
      gateway_reference: tx.reference,
      gateway_status: tx.status,
      source: 'portal',
      // A verified, full payment needs no one to check it: that's the point
      // of paying online. Anything odd waits on the Payments page.
      status: problem ? 'submitted' : 'approved',
      verified_at: problem ? null : now,
      note: problem ? `Paystack: ${problem}.` : null,
    },
  ]);
  if (insertErr) {
    // The webhook and the customer's return raced and the other one won.
    if (insertErr.code === '23505') return { outcome: 'paid', order, alreadyRecorded: true };
    throw insertErr;
  }

  const label = saleLabel(order);
  const customer = order.users?.company_name || order.users?.email || 'A customer';

  if (problem) {
    await Promise.all([
      notifyInternalTeam({
        type: 'general',
        title: 'Paystack payment needs checking',
        message: `${customer} paid ${formatCurrency(amountPaid)} on Paystack for ${label}, but ${problem}. Check it on the Payments page; a refund, if needed, is done in the Paystack dashboard (reference ${tx.reference}).`,
        relatedType: 'order',
        relatedId: orderId,
      }),
      logActivity({
        actorLabel: ACTOR,
        action: 'payment.needs_review',
        entityType: 'order',
        entityId: orderId,
        description: `Paystack payment ${tx.reference} of ${formatCurrency(amountPaid)} for ${label} needs checking: ${problem}.`,
      }),
    ]);
    return { outcome: 'needs_review', order, problem };
  }

  const result = await transitionOrderStatus(orderId, 'confirmed');
  if (result.error) {
    // The payment is real and recorded; only the order didn't follow (it
    // changed in the same instant). Staff can move it from the order page.
    console.error('Paystack: payment recorded but order not confirmed:', result.error);
    await notifyInternalTeam({
      type: 'general',
      title: 'Paystack payment recorded, order not updated',
      message: `${customer} paid ${label} on Paystack (${tx.reference}), but the order could not be marked paid: ${result.error}`,
      relatedType: 'order',
      relatedId: orderId,
    });
    return { outcome: 'paid', order };
  }

  await Promise.all([
    notifyUser({
      userId: order.customer_id,
      type: 'order_status_changed',
      title: 'Payment received',
      message: `We've received your payment for ${label}. Your receipt is available in the portal.`,
      relatedType: 'order',
      relatedId: orderId,
      email: order.users?.email,
      phone: order.users?.phone,
    }),
    logActivity({
      actorLabel: ACTOR,
      action: 'order.status_changed',
      entityType: 'order',
      entityId: orderId,
      description: `Paystack confirmed a payment of ${formatCurrency(amountPaid)} for ${label} (${tx.reference}); status moved from "${order.status}" to "confirmed".`,
    }),
  ]);

  return { outcome: 'paid', order };
}

module.exports = { ONLINE_PAYABLE_STATUSES, recordPaystackTransaction };

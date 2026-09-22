const supabase = require('../config/supabase');
const { notifyUser } = require('./notificationService');
const { transitionOrderStatus } = require('./orderStateService');

// Payments reach this system two ways, and only two:
//
//   1. PayFast, verified by the ITN webhook (payfastWebhookController.js) --
//      the customer's only self-service route.
//   2. A staff member recording money they have already seen land in the
//      bank (recordStaffPayment, below) -- EFT, cash on collection, a
//      purchase order settled offline.
//
// Customers no longer submit their own bank-transfer "proof". That path used
// to leave the order sitting in 'stock_reserved' waiting for an admin, which
// release_expired_reservations() would then cancel out from under it an hour
// later -- while the customer's money was already in transit. A screenshot
// was never evidence of payment anyway: only the person who can see the bank
// account can confirm an EFT, so only they can record one.
const PAYABLE_STATUSES = ['approved', 'stock_reserved', 'awaiting_payment'];

// The order states a recorded payment moves *to*. Both legal transitions are
// declared in orderStateService.js; going through transitionOrderStatus()
// rather than writing orders.status directly keeps this path under the same
// single gatekeeper as the PayFast webhook and the admin dropdown.
const PAID_STATUS = 'confirmed';

// Staff records a payment they have verified themselves. Unlike the old
// two-step submit-then-approve dance, this writes the payment already
// approved and confirms the order in the same call -- the admin looking at
// their own bank statement *is* the review, so asking them to then approve
// their own entry on a second screen was ceremony, not control.
//
// Confirming the order also takes it out of 'stock_reserved', which is what
// stops the reservation-expiry job from cancelling a legitimately paid
// order.
async function recordStaffPayment(orderId, reviewerId, { method, reference, amount, note }) {
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .select('id, order_number, status, customer_id, total_amount, users(email, company_name, phone)')
    .eq('id', orderId)
    .single();

  if (orderErr || !order) return { error: 'Order not found', status: 404 };
  if (!PAYABLE_STATUSES.includes(order.status)) {
    return {
      error: `An order that is "${order.status}" can't take a payment.`,
      status: 400,
    };
  }

  const { data: existing, error: existingErr } = await supabase
    .from('payments')
    .select('id')
    .eq('order_id', orderId)
    .in('status', ['submitted', 'approved']);

  if (existingErr) throw existingErr;
  if (existing && existing.length > 0) {
    return { error: 'This order has already been paid.', status: 400 };
  }

  const now = new Date().toISOString();
  const { data: payment, error } = await supabase
    .from('payments')
    .insert([
      {
        order_id: orderId,
        customer_id: order.customer_id,
        method,
        reference,
        amount,
        note: note || null,
        source: 'admin',
        status: 'approved',
        reviewed_by: reviewerId,
        reviewed_at: now,
        verified_at: now,
      },
    ])
    .select()
    .single();

  if (error) throw error;

  // The order must follow the money. If this fails the payment row is still
  // correct (it records real money), so surface the problem rather than
  // unwinding it -- staff can move the status by hand from the order page.
  const transition = await transitionOrderStatus(orderId, PAID_STATUS);
  if (transition.error) {
    return {
      error: `Payment recorded, but the order could not be marked as paid: ${transition.error}`,
      status: 400,
    };
  }

  await notifyUser({
    userId: order.customer_id,
    type: 'order_status_changed',
    title: 'Payment received',
    message: `We've received your payment for order #${order.order_number}. Your receipt is available in the portal.`,
    relatedType: 'order',
    relatedId: orderId,
    email: order.users?.email,
    phone: order.users?.phone,
  });

  return {
    paymentId: payment.id,
    orderNumber: order.order_number,
    orderStatus: PAID_STATUS,
    customerLabel: order.users?.company_name || order.users?.email,
  };
}

// Approve or reject a payment that is still sitting as 'submitted'. Nothing
// in the app creates those any more -- recordStaffPayment writes straight to
// 'approved', and the PayFast webhook only leaves 'submitted' behind for a
// gateway payment that came back pending/failed/short. This stays so those
// gateway edge cases, and any row predating this change, can still be closed
// out from the Payments page.
async function reviewPayment(paymentId, status, reviewerId) {
  if (!['approved', 'rejected'].includes(status)) {
    return { error: "Status must be 'approved' or 'rejected'.", status: 400 };
  }

  const { data: payment, error: findErr } = await supabase
    .from('payments')
    .select('id, status, customer_id, order_id, users!payments_customer_id_fkey(email, company_name, phone), orders(order_number, status)')
    .eq('id', paymentId)
    .single();

  if (findErr || !payment) return { error: 'Payment not found', status: 404 };
  if (payment.status !== 'submitted') {
    return { error: `Payment is already "${payment.status}" and can't be reviewed again.`, status: 400 };
  }

  const { error } = await supabase
    .from('payments')
    .update({ status, reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
    .eq('id', paymentId);

  if (error) throw error;

  if (status === 'approved') {
    // Same "the order must follow the money" rule as recordStaffPayment.
    // Best-effort here rather than an error: the order may legitimately have
    // moved on already (a stock_reserved order whose PayFast ITN landed
    // first, say), in which case there is nothing to move and nothing wrong.
    if (PAYABLE_STATUSES.includes(payment.orders?.status)) {
      const transition = await transitionOrderStatus(payment.order_id, PAID_STATUS);
      if (transition.error) {
        console.error('Could not confirm order after approving payment:', transition.error);
      }
    }

    await notifyUser({
      userId: payment.customer_id,
      type: 'general',
      title: 'Payment approved',
      message: `Your payment for order #${payment.orders?.order_number} has been approved. Thank you!`,
      relatedType: 'payment',
      relatedId: paymentId,
      email: payment.users?.email,
      phone: payment.users?.phone,
    });
  }

  return {
    paymentId,
    status,
    orderId: payment.order_id,
    orderNumber: payment.orders?.order_number,
    customerLabel: payment.users?.company_name || payment.users?.email,
  };
}

module.exports = { recordStaffPayment, reviewPayment, PAYABLE_STATUSES };

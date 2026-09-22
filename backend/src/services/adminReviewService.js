const supabase = require('../config/supabase');
const { friendlyRpcErrorMessage } = require('../utils/rpcErrorMessage');

const HIGH_VALUE_STATUSES = ['completed', 'confirmed', 'ready_for_collection'];

function threshold() {
  return Number(process.env.ADMIN_REVIEW_THRESHOLD) || 50000;
}

async function insertReview(orderId, reason) {
  const { error } = await supabase.from('admin_reviews').insert([{ order_id: orderId, reason }]);
  if (error) throw error;
}

// Called right after checkout, regardless of whether stock was available --
// these two reasons flag an order for staff attention without blocking the
// automated path (stock reservation/PayFast payment proceed normally either
// way, per "never block other customers' orders").
// `netAmount` is the order's value excluding VAT (see the caller): the
// threshold is about the size of the deal, not the tax on top of it.
async function flagIfNeeded(orderId, customerId, netAmount) {
  // The high-value insert and the new-customer history count don't depend
  // on each other -- kick both off together instead of paying for them
  // sequentially on the checkout path.
  const [, { count, error }] = await Promise.all([
    Number(netAmount) > threshold() ? insertReview(orderId, 'high_value') : Promise.resolve(),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId)
      .in('status', HIGH_VALUE_STATUSES)
      .neq('id', orderId),
  ]);
  if (error) throw error;

  if (!count) {
    await insertReview(orderId, 'new_customer');
  }
}

// Insufficient-stock fast-checkout attempts fall back to the *existing*
// pending_approval state (checkout_quote_with_reservation), so they need
// their own review row logged by the caller -- this is that helper, kept
// distinct from flagIfNeeded since it always fires unconditionally (no
// threshold/history check, the reason is already known at the call site).
async function flagStockShort(orderId) {
  await insertReview(orderId, 'stock_short');
}

async function listPendingReviews() {
  const { data, error } = await supabase
    .from('admin_reviews')
    .select('*, orders(order_number, total_amount, status, customer_id, users(email, company_name))')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data;
}

// action depends on the review's reason -- each branch reuses the existing
// mechanism for that kind of state change rather than reimplementing it:
// approve_order/cancel_order (stock_short), or a plain resolve/cancel for the
// two non-blocking flags.
//
// There is no longer a 'manual_payment' reason. Customers can't declare their
// own payments any more, and a payment a staff member records is verified by
// the act of recording it (paymentService.js), so nothing needs a second pair
// of eyes in this queue.
async function resolveReview(reviewId, action, reviewerId) {
  const { data: review, error: findErr } = await supabase
    .from('admin_reviews')
    .select('id, order_id, reason, status, orders(order_number)')
    .eq('id', reviewId)
    .single();

  if (findErr || !review) return { error: 'Review not found', status: 404 };
  if (review.status !== 'pending') {
    return { error: 'This review has already been resolved.', status: 400 };
  }

  if (review.reason === 'stock_short') {
    if (!['approve', 'reject'].includes(action)) {
      return { error: "Action must be 'approve' or 'reject' for a stock_short review.", status: 400 };
    }
    const rpc = action === 'approve' ? 'approve_order' : 'cancel_order';
    const { error } = await supabase.rpc(rpc, { p_order_id: review.order_id });
    if (error) return { error: friendlyRpcErrorMessage(error.message), status: 400 };
  } else {
    // high_value / new_customer -- informational flags on an order that's
    // otherwise already proceeding (or already sitting in the manual queue
    // for its own reasons); resolving just means "staff looked at this".
    if (!['acknowledge', 'cancel'].includes(action)) {
      return { error: "Action must be 'acknowledge' or 'cancel' for this review.", status: 400 };
    }
    if (action === 'cancel') {
      const { error } = await supabase.rpc('cancel_order', { p_order_id: review.order_id });
      if (error) return { error: friendlyRpcErrorMessage(error.message), status: 400 };
    }
  }

  const { error: resolveErr } = await supabase
    .from('admin_reviews')
    .update({ status: 'resolved', resolved_at: new Date().toISOString(), assigned_to: reviewerId })
    .eq('id', reviewId);
  if (resolveErr) throw resolveErr;

  return { reviewId, action, reason: review.reason, orderId: review.order_id, orderNumber: review.orders?.order_number };
}

module.exports = { flagIfNeeded, flagStockShort, listPendingReviews, resolveReview };

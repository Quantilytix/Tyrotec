const supabase = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const {
  PaystackError,
  initializeTransaction,
  verifyTransaction,
  verifyWebhookSignature,
  metadataOf,
} = require('../services/paystackService');
const { ONLINE_PAYABLE_STATUSES, recordPaystackTransaction } = require('../services/onlinePaymentService');

// Customer only: start paying for one of their own orders. Returns the
// Paystack page to send the browser to; no Paystack key ever leaves the
// server.
const startPayment = asyncHandler(async (req, res) => {
  const { data: order, error } = await supabase
    .from('orders')
    .select('id, order_number, invoice_number, status, total_amount, customer_id, users(email)')
    .eq('id', req.params.id)
    .eq('customer_id', req.user.id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  if (!order) return res.status(404).json({ error: 'Order not found' });

  if (!ONLINE_PAYABLE_STATUSES.includes(order.status)) {
    return res.status(400).json({ error: 'This order is not waiting for a payment.' });
  }

  const { data: paid, error: paidErr } = await supabase
    .from('payments')
    .select('id')
    .eq('order_id', order.id)
    .in('status', ['submitted', 'approved'])
    .limit(1);
  if (paidErr) throw paidErr;
  if (paid.length > 0) return res.status(400).json({ error: 'This order has already been paid.' });

  try {
    const { authorizationUrl, reference } = await initializeTransaction(order, order.users?.email || req.user.email);
    return res.json({ url: authorizationUrl, reference });
  } catch (err) {
    if (!(err instanceof PaystackError)) throw err;
    console.error('Paystack: could not start a payment:', err.message);
    return res.status(502).json({ error: 'Online payment is unavailable right now. Please try again shortly, or pay by EFT.' });
  }
});

// Customer only: they're back from Paystack (?reference=... on the order
// page). Asks Paystack what happened rather than waiting for the webhook, so
// the page can say "paid" straight away -- and so payments work at all where
// Paystack can't reach the webhook (a developer's own machine).
const confirmReturn = asyncHandler(async (req, res) => {
  const reference = String(req.body?.reference || '').trim();
  if (!reference) return res.status(400).json({ error: 'reference is required' });

  const { data: order, error } = await supabase
    .from('orders')
    .select('id')
    .eq('id', req.params.id)
    .eq('customer_id', req.user.id)
    .maybeSingle();
  if (error) throw error;
  if (!order) return res.status(404).json({ error: 'Order not found' });

  let tx;
  try {
    tx = await verifyTransaction(reference);
  } catch (err) {
    if (!(err instanceof PaystackError)) throw err;
    // Unknown reference, or Paystack unreachable. The webhook still settles it.
    return res.json({ outcome: 'unknown' });
  }

  // Someone else's reference pasted onto this order's URL changes nothing.
  if (metadataOf(tx).order_id !== order.id) return res.status(400).json({ error: 'That payment is for a different order.' });

  const result = await recordPaystackTransaction(tx);
  return res.json({ outcome: result.outcome });
});

// Paystack -> us, server to server. Always answers 200 once the signature
// checks out, or Paystack retries for days; anything that goes wrong is
// logged, and the customer's return to the portal is a second chance.
const receiveWebhook = asyncHandler(async (req, res) => {
  if (!verifyWebhookSignature(req.rawBody, req.get('x-paystack-signature'))) {
    console.error('Paystack webhook: bad signature');
    return res.sendStatus(401);
  }

  const event = req.body || {};
  if (event.event !== 'charge.success' || !event.data?.reference) return res.sendStatus(200);

  try {
    // Signed is good; asked-Paystack-ourselves is the rule everywhere.
    const tx = await verifyTransaction(event.data.reference);
    const result = await recordPaystackTransaction(tx);
    if (result.outcome === 'unknown_order') {
      console.error('Paystack webhook: no order for', event.data.reference);
    }
  } catch (err) {
    console.error('Paystack webhook: could not record', event.data.reference, err.message);
    // 500 so Paystack tries again later.
    return res.sendStatus(500);
  }
  return res.sendStatus(200);
});

module.exports = { startPayment, confirmReturn, receiveWebhook };

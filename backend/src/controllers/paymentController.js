const crypto = require('crypto');
const path = require('path');
const supabase = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const { isStaff } = require('../utils/roles');
const { submitPaymentForCustomer, reviewPayment } = require('../services/paymentService');
const { logActivity } = require('../services/activityLogService');

const PAYMENT_PROOFS_BUCKET = 'payment-proofs';

// Customer: submit a bank-transfer/EFT proof of payment against one of their
// own approved orders. There's no payment gateway here -- staff manually
// cross-check the reference against their bank statement and approve/reject.
//
// Staff (admin/sales_rep) can also submit a payment on a customer's behalf
// -- same idea as the staff branch in quoteController.js's
// convertQuoteToOrder -- so the customer is resolved from the order itself
// instead of assuming req.user is the customer.
const createPayment = asyncHandler(async (req, res) => {
  const { order_id, method, reference, amount, note, proof_url } = req.body;
  const submittedByStaff = isStaff(req.user.role);

  let customerId = req.user.id;
  let customerLabel = req.user.company_name || req.user.email;

  if (submittedByStaff) {
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('customer_id, users(email, company_name)')
      .eq('id', order_id)
      .single();
    if (orderErr || !order) return res.status(404).json({ error: 'Order not found' });

    customerId = order.customer_id;
    customerLabel = order.users?.company_name || order.users?.email || customerLabel;
  }

  const result = await submitPaymentForCustomer(
    customerId,
    customerLabel,
    { orderId: order_id, method, reference, amount, note, proofUrl: proof_url },
    submittedByStaff ? 'admin' : 'portal'
  );
  if (result.error) return res.status(result.status).json({ error: result.error });

  return res.status(201).json({ message: 'Payment submitted successfully', ...result });
});

// Admin/sales_rep only: every submitted payment across all customers.
const getAllPaymentsAdmin = asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('payments')
    .select('*, orders(id, order_number, total_amount), users!payments_customer_id_fkey(email, company_name)')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return res.json(data);
});

// Admin/sales_rep only. Only a 'submitted' payment can be approved/rejected
// -- once reviewed, it's final (a rejected payment can be resubmitted as a
// new row via createPayment instead of being reopened here).
const updatePaymentStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const result = await reviewPayment(id, status, req.user.id);
  if (result.error) return res.status(result.status).json({ error: result.error });

  await logActivity({
    actorId: req.user.id,
    actorRole: req.user.role,
    actorLabel: req.user.company_name || req.user.email,
    action: 'payment.reviewed',
    entityType: 'payment',
    entityId: id,
    description: `${req.user.company_name || req.user.email} ${status} ${result.customerLabel}'s payment for order #${result.orderNumber}.`,
  });

  return res.json({ message: 'Payment status updated', ...result });
});

// Same upload-then-reference pattern as uploadProductImage in
// productController.js -- puts the file in its own bucket under a random
// filename (never the original filename), hands back a public URL the
// frontend includes as proof_url in the manual-payment submission below.
const uploadPaymentProof = asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  const ext = path.extname(req.file.originalname) || '.jpg';
  const filename = `${crypto.randomUUID()}${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(PAYMENT_PROOFS_BUCKET)
    .upload(filename, req.file.buffer, { contentType: req.file.mimetype, upsert: false });

  if (uploadError) return res.status(400).json({ error: uploadError.message });

  const { data } = supabase.storage.from(PAYMENT_PROOFS_BUCKET).getPublicUrl(filename);
  return res.status(201).json({ url: data.publicUrl });
});

// POST /api/orders/:orderId/manual-payment -- the PayFast ticket's explicit
// fallback path: a customer whose order is stock_reserved (or, same as
// today, approved) submits manual bank-transfer proof instead of paying via
// PayFast. Reuses the exact same submitPaymentForCustomer pipeline the
// existing POST /payments route already uses (createPayment above) --
// submitPaymentForCustomer itself decides whether to log an admin_reviews
// row (only for a stock_reserved order, since that's the "chose bank
// transfer instead of PayFast" case a verified webhook can't cover), so
// this endpoint and createPayment get identical, correct behavior for free.
const submitManualPaymentForReview = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { method, reference, amount, note, proof_url } = req.body;
  const customerLabel = req.user.company_name || req.user.email;

  const result = await submitPaymentForCustomer(
    req.user.id,
    customerLabel,
    { orderId, method, reference, amount, note, proofUrl: proof_url },
    'portal'
  );
  if (result.error) return res.status(result.status).json({ error: result.error });

  return res.status(201).json({ message: 'Payment submitted for review', ...result });
});

module.exports = {
  createPayment,
  getAllPaymentsAdmin,
  updatePaymentStatus,
  uploadPaymentProof,
  submitManualPaymentForReview,
};

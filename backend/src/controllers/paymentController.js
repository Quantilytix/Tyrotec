const supabase = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const { recordStaffPayment, reviewPayment } = require('../services/paymentService');
const { logActivity } = require('../services/activityLogService');

// Staff only: record a payment that has already been verified in the bank --
// an EFT, cash on collection, or a purchase order settled offline. Writes the
// payment as approved and confirms the order in one step (see
// paymentService.js for why there is no customer-facing version of this).
//
// The customer is resolved from the order itself, never from req.user, since
// the person recording the payment is a staff member acting on a customer's
// order.
const recordPayment = asyncHandler(async (req, res) => {
  const { order_id, method, reference, amount, note } = req.body;

  const result = await recordStaffPayment(order_id, req.user.id, { method, reference, amount, note });
  if (result.error) return res.status(result.status).json({ error: result.error });

  await logActivity({
    actorId: req.user.id,
    actorRole: req.user.role,
    actorLabel: req.user.company_name || req.user.email,
    action: 'payment.recorded',
    entityType: 'payment',
    entityId: result.paymentId,
    description: `${req.user.company_name || req.user.email} recorded a ${method} payment for ${result.customerLabel}'s order #${result.orderNumber}, marking it as paid.`,
  });

  return res.status(201).json({ message: 'Payment recorded', ...result });
});

// Admin/sales_rep only: every payment across all customers.
const getAllPaymentsAdmin = asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('payments')
    .select('*, orders(id, order_number, total_amount), users!payments_customer_id_fkey(email, company_name)')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return res.json(data);
});

// Admin/sales_rep only. Only a 'submitted' payment can be approved/rejected,
// and nothing creates those any more except a PayFast payment that came back
// pending, failed or short -- this is how those get closed out.
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

module.exports = {
  recordPayment,
  getAllPaymentsAdmin,
  updatePaymentStatus,
};

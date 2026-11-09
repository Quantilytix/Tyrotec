const supabase = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const { recordStaffPayment, reviewPayment, archivePayment } = require('../services/paymentService');
const { logActivity } = require('../services/activityLogService');

// Staff only: record a payment that has already been verified in the bank --
// an EFT, cash on collection, or a purchase order settled offline. Writes the
// payment as approved and confirms the order in one step (see
// paymentService.js for why there is no customer-facing version of this).
// An order still waiting for stock stays waiting, already paid.
//
// The customer is resolved from the order itself, never from req.user, since
// the person recording the payment is a staff member acting on a customer's
// order.
const recordPayment = asyncHandler(async (req, res) => {
  const { order_id, method, reference, amount, note, notify_customer } = req.body;

  const result = await recordStaffPayment(order_id, req.user.id, {
    method,
    reference,
    amount,
    note,
    notifyCustomer: notify_customer !== false,
  });
  if (result.error) return res.status(result.status).json({ error: result.error });

  const outcome = result.orderStatus === 'confirmed' ? 'marking it as paid' : 'to be marked as paid once its stock is in';
  await logActivity({
    actorId: req.user.id,
    actorRole: req.user.role,
    actorLabel: req.user.company_name || req.user.email,
    action: 'payment.recorded',
    entityType: 'payment',
    entityId: result.paymentId,
    description: `${req.user.company_name || req.user.email} recorded a ${method} payment for ${result.customerLabel}'s order #${result.orderNumber}, ${outcome}${notify_customer === false ? ' (customer not notified)' : ''}.`,
  });

  return res.status(201).json({ message: 'Payment recorded', ...result });
});

// Admin/sales_rep only: every payment across all customers. Archived ones
// (044) only with ?archived=true, and then only those.
const getAllPaymentsAdmin = asyncHandler(async (req, res) => {
  let query = supabase
    .from('payments')
    .select('*, orders!inner(id, order_number, invoice_number, total_amount), users!payments_customer_id_fkey(email, company_name)')
    // Not the payments of an order or invoice in Recently deleted (046).
    .is('orders.deleted_at', null)
    .order('created_at', { ascending: false });
  query = req.query.archived === 'true' ? query.not('archived_at', 'is', null) : query.is('archived_at', null);

  const { data, error } = await query;
  if (error) throw error;
  return res.json(data);
});

// Admin only. body: { archived: true | false }.
const setPaymentArchived = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { archived } = req.body;

  const result = await archivePayment(id, archived);
  if (result.error) return res.status(result.status).json({ error: result.error });

  await logActivity({
    actorId: req.user.id,
    actorRole: req.user.role,
    actorLabel: req.user.company_name || req.user.email,
    action: archived ? 'payment.archived' : 'payment.restored',
    entityType: 'payment',
    entityId: id,
    description: `${req.user.company_name || req.user.email} ${archived ? 'archived' : 'restored'} ${result.customerLabel}'s payment for ${result.saleName}.`,
  });

  return res.json({ message: archived ? 'Payment archived' : 'Payment restored', ...result });
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
  setPaymentArchived,
};

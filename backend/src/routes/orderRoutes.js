const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const {
  getCustomerOrders,
  getAllOrdersAdmin,
  exportOrdersAdmin,
  getOrderById,
  updateOrderStatus,
  initiatePayfastPayment,
  getOrderStatus,
  payOnInvoice,
  updateStockEta,
  getInvoicePdf,
  emailInvoice,
} = require('../controllers/orderController');
const { authenticateToken, requireRole } = require('../middleware/auth');
const validate = require('../middleware/validate');

router.get('/my-orders', authenticateToken, getCustomerOrders);
router.get('/admin/all', authenticateToken, requireRole(['admin', 'sales_rep']), getAllOrdersAdmin);
router.get('/admin/export', authenticateToken, requireRole(['admin', 'sales_rep']), exportOrdersAdmin);
router.get('/:orderId/status', authenticateToken, getOrderStatus);
// Staff-made sales (invoices): the tax invoice PDF, for staff and the customer.
router.get('/:id/invoice-pdf', authenticateToken, getInvoicePdf);
router.post('/:id/email-invoice', authenticateToken, requireRole(['admin', 'sales_rep']), emailInvoice);
router.get('/:id', authenticateToken, getOrderById);
router.post('/:id/pay', authenticateToken, initiatePayfastPayment);
// Customer only, and only for accounts flagged can_order_on_account.
router.post('/:id/pay-on-invoice', authenticateToken, requireRole(['customer']), payOnInvoice);
router.patch(
  '/:id/status',
  authenticateToken,
  requireRole(['admin', 'sales_rep']),
  body('status').isString().notEmpty(),
  validate,
  updateOrderStatus
);

// Staff tell the customer when stock for a waiting order should arrive.
router.patch(
  '/:id/stock-eta',
  authenticateToken,
  requireRole(['admin', 'sales_rep']),
  body('days').isInt({ min: 0, max: 365 }),
  validate,
  updateStockEta
);

module.exports = router;

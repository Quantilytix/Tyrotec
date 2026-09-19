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
} = require('../controllers/orderController');
const { submitManualPaymentForReview } = require('../controllers/paymentController');
const { authenticateToken, requireRole } = require('../middleware/auth');
const validate = require('../middleware/validate');

router.get('/my-orders', authenticateToken, getCustomerOrders);
router.get('/admin/all', authenticateToken, requireRole(['admin', 'sales_rep']), getAllOrdersAdmin);
router.get('/admin/export', authenticateToken, requireRole(['admin', 'sales_rep']), exportOrdersAdmin);
router.get('/:orderId/status', authenticateToken, getOrderStatus);
router.get('/:id', authenticateToken, getOrderById);
router.post('/:id/pay', authenticateToken, initiatePayfastPayment);
router.post(
  '/:orderId/manual-payment',
  authenticateToken,
  body('method').isString().notEmpty().withMessage('Payment method is required'),
  body('reference').isString().notEmpty().withMessage('Reference number is required'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),
  validate,
  submitManualPaymentForReview
);
router.patch(
  '/:id/status',
  authenticateToken,
  requireRole(['admin', 'sales_rep']),
  body('status').isString().notEmpty(),
  validate,
  updateOrderStatus
);

module.exports = router;

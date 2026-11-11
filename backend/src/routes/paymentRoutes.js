const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const {
  recordPayment,
  getAllPaymentsAdmin,
  updatePaymentStatus,
  setPaymentArchived,
} = require('../controllers/paymentController');
const { authenticateToken, requireRole } = require('../middleware/auth');
const validate = require('../middleware/validate');

const recordPaymentRules = [
  body('order_id').isUUID().withMessage('A valid order_id is required'),
  body('method').isString().notEmpty().withMessage('Payment method is required'),
  body('reference').isString().notEmpty().withMessage('Reference number is required'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),
  body('notify_customer').optional().isBoolean().withMessage('notify_customer must be true or false').toBoolean(true),
];

// Staff only. Customers pay through Paystack (POST /orders/:id/pay) and have
// no route for declaring their own payment -- see paymentService.js.
router.post(
  '/',
  authenticateToken,
  requireRole(['admin', 'sales_rep']),
  recordPaymentRules,
  validate,
  recordPayment
);
router.get('/admin/all', authenticateToken, requireRole(['admin', 'sales_rep']), getAllPaymentsAdmin);
router.patch(
  '/:id/status',
  authenticateToken,
  requireRole(['admin', 'sales_rep']),
  body('status').isIn(['approved', 'rejected']),
  validate,
  updatePaymentStatus
);
// Admin only: clearing payments off the Payments page is an oversight call.
router.patch(
  '/:id/archive',
  authenticateToken,
  requireRole(['admin']),
  body('archived').isBoolean().withMessage('archived must be true or false').toBoolean(true),
  validate,
  setPaymentArchived
);

module.exports = router;

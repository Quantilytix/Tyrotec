const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const {
  recordPayment,
  getAllPaymentsAdmin,
  updatePaymentStatus,
} = require('../controllers/paymentController');
const { authenticateToken, requireRole } = require('../middleware/auth');
const validate = require('../middleware/validate');

const recordPaymentRules = [
  body('order_id').isUUID().withMessage('A valid order_id is required'),
  body('method').isString().notEmpty().withMessage('Payment method is required'),
  body('reference').isString().notEmpty().withMessage('Reference number is required'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),
];

// Staff only. Customers pay through PayFast (POST /orders/:id/pay) and have
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

module.exports = router;

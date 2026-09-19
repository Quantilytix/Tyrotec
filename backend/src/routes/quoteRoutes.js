const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const {
  createQuote,
  createQuoteForCustomerAdmin,
  getCustomerQuotes,
  getAllQuotesAdmin,
  exportQuotesAdmin,
  getQuoteById,
  updateQuoteStatus,
  convertQuoteToOrder,
  checkoutQuoteFast,
} = require('../controllers/quoteController');
const { authenticateToken, requireRole } = require('../middleware/auth');
const validate = require('../middleware/validate');

const createQuoteRules = [
  body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
  body('items.*.product_id').isUUID().withMessage('Each item needs a valid product_id'),
  body('items.*.quantity').isInt({ min: 1 }).withMessage('Each item needs a quantity of at least 1'),
];

const createQuoteForCustomerRules = [
  body('customer_id').isUUID().withMessage('A valid customer_id is required'),
  ...createQuoteRules,
];

router.post('/', authenticateToken, createQuoteRules, validate, createQuote);
router.post(
  '/admin/for-customer',
  authenticateToken,
  requireRole(['admin', 'sales_rep']),
  createQuoteForCustomerRules,
  validate,
  createQuoteForCustomerAdmin
);
router.get('/my-quotes', authenticateToken, getCustomerQuotes);
router.get('/admin/all', authenticateToken, requireRole(['admin', 'sales_rep']), getAllQuotesAdmin);
router.get('/admin/export', authenticateToken, requireRole(['admin', 'sales_rep']), exportQuotesAdmin);
router.get('/:quoteId', authenticateToken, getQuoteById);
router.patch(
  '/:quoteId/status',
  authenticateToken,
  requireRole(['admin', 'sales_rep']),
  body('status').isString().notEmpty(),
  validate,
  updateQuoteStatus
);
// Customer only -- staff can no longer convert a quote to an order on a
// customer's behalf (see convertQuoteToOrder's own comment for why).
router.post('/:quoteId/convert', authenticateToken, requireRole(['customer']), convertQuoteToOrder);
router.post('/:quoteId/checkout', authenticateToken, checkoutQuoteFast);

module.exports = router;

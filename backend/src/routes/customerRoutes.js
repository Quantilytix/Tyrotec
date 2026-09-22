const express = require('express');
const router = express.Router();
const {
  getAllCustomersAdmin,
  getCustomerDetailAdmin,
  createCustomerAdmin,
  setCustomerAccountTerms,
} = require('../controllers/customerController');
const { authenticateToken, requireRole } = require('../middleware/auth');

router.get('/admin/all', authenticateToken, requireRole(['admin', 'sales_rep']), getAllCustomersAdmin);
router.post('/admin', authenticateToken, requireRole(['admin', 'sales_rep']), createCustomerAdmin);
router.get('/admin/:id', authenticateToken, requireRole(['admin', 'sales_rep']), getCustomerDetailAdmin);
// Credit decision: lets this customer order on invoice instead of paying up
// front. Declared after the GET so it doesn't shadow it.
router.patch(
  '/admin/:id/account-terms',
  authenticateToken,
  requireRole(['admin', 'sales_rep']),
  setCustomerAccountTerms
);

module.exports = router;

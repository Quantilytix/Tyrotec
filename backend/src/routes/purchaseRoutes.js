const express = require('express');
const router = express.Router();
const { listPurchases, getPurchase, createPurchase } = require('../controllers/purchaseController');
const { authenticateToken, requireRole } = require('../middleware/auth');

// Recording goods received is a stock job, so the same staff who manage
// products can do it. Purchases are never edited or deleted afterwards.
router.get('/', authenticateToken, requireRole(['admin', 'sales_rep']), listPurchases);
router.get('/:id', authenticateToken, requireRole(['admin', 'sales_rep']), getPurchase);
router.post('/', authenticateToken, requireRole(['admin', 'sales_rep']), createPurchase);

module.exports = router;

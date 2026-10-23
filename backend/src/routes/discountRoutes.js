const express = require('express');
const router = express.Router();
const { getDiscounts, postDiscount, postEndDiscount } = require('../controllers/discountController');
const { authenticateToken, requireRole } = require('../middleware/auth');

// Admins only: a discount changes what customers pay.
router.get('/', authenticateToken, requireRole(['admin']), getDiscounts);
router.post('/', authenticateToken, requireRole(['admin']), postDiscount);
router.post('/:id/end', authenticateToken, requireRole(['admin']), postEndDiscount);

module.exports = router;

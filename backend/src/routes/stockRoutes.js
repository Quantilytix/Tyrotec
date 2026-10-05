const express = require('express');
const router = express.Router();
const {
  listAdjustments,
  createAdjustment,
  getOpeningStock,
  createOpeningStock,
} = require('../controllers/stockController');
const { authenticateToken, requireRole } = require('../middleware/auth');

// Writing stock off (or back on) and the one-off opening stock both change
// what the stock is worth in the books, so they're admin decisions.
router.get('/adjustments', authenticateToken, requireRole(['admin', 'sales_rep']), listAdjustments);
router.post('/adjustments', authenticateToken, requireRole(['admin']), createAdjustment);
router.get('/opening', authenticateToken, requireRole(['admin']), getOpeningStock);
router.post('/opening', authenticateToken, requireRole(['admin']), createOpeningStock);

module.exports = router;

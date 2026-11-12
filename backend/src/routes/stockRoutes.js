const express = require('express');
const router = express.Router();
const {
  listAdjustments,
  createAdjustment,
  createCorrection,
  getOpeningStock,
  createOpeningStock,
} = require('../controllers/stockController');
const { authenticateToken, requireRole } = require('../middleware/auth');

// Adjusting stock (damaged, lost, count corrections...) is open to sales reps
// too, for quantities only: they can't set a cost, and admins are told about
// every adjustment a rep makes (stockController.createAdjustment).
// Corrections and the one-off opening stock change what the stock is worth
// in the books, so they stay admin decisions.
router.get('/adjustments', authenticateToken, requireRole(['admin', 'sales_rep']), listAdjustments);
router.post('/adjustments', authenticateToken, requireRole(['admin', 'sales_rep']), createAdjustment);
// Admin: put a product's stock and/or average cost right after a mistake.
router.post('/corrections', authenticateToken, requireRole(['admin']), createCorrection);
router.get('/opening', authenticateToken, requireRole(['admin']), getOpeningStock);
router.post('/opening', authenticateToken, requireRole(['admin']), createOpeningStock);

module.exports = router;

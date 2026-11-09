const express = require('express');
const router = express.Router();
const { getRecentlyDeleted, deleteToBin, restoreFromBin } = require('../controllers/recentlyDeletedController');
const { authenticateToken, requireRole } = require('../middleware/auth');

// Admin only: deleting and restoring is an oversight call.
// :type is quote, order (orders and invoices), purchase or customer.
router.get('/', authenticateToken, requireRole(['admin']), getRecentlyDeleted);
router.post('/:type/:id', authenticateToken, requireRole(['admin']), deleteToBin);
router.post('/:type/:id/restore', authenticateToken, requireRole(['admin']), restoreFromBin);

module.exports = router;

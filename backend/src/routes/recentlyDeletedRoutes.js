const express = require('express');
const router = express.Router();
const { getRecentlyDeleted, deleteToBin, restoreFromBin } = require('../controllers/recentlyDeletedController');
const { authenticateToken, requireRole } = require('../middleware/auth');

// Deleting is open to sales reps too (admins are told about each one); the
// Recently deleted page and restoring stay with admins, so a rep can't
// delete something and quietly bring it back.
// :type is quote, order (orders and invoices), purchase or customer.
router.get('/', authenticateToken, requireRole(['admin']), getRecentlyDeleted);
router.post('/:type/:id', authenticateToken, requireRole(['admin', 'sales_rep']), deleteToBin);
router.post('/:type/:id/restore', authenticateToken, requireRole(['admin']), restoreFromBin);

module.exports = router;

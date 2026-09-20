const express = require('express');
const router = express.Router();
const { getActivityLog, getActivityActions } = require('../controllers/activityLogController');
const { authenticateToken, requireRole } = require('../middleware/auth');

// Admin and above -- deliberately excludes sales_rep, unlike almost every
// other admin/* route in this app. Part of this log's purpose is oversight of
// what sales_rep accounts are doing, so they can't be allowed to read it.
// (requireRole ranks roles, so 'admin' here also admits a super admin.)
router.get('/', authenticateToken, requireRole(['admin']), getActivityLog);
router.get('/actions', authenticateToken, requireRole(['admin']), getActivityActions);

module.exports = router;

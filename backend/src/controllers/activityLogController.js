const asyncHandler = require('../utils/asyncHandler');
const { listActivity, listActions } = require('../services/activityLogService');

// Admin and super admin only -- see activityLogRoutes.js. `audience` selects
// the customer-activity or staff-activity view.
const getActivityLog = asyncHandler(async (req, res) => {
  const { page, limit, audience, action, search, from, to } = req.query;
  const result = await listActivity({ page, limit, audience, action, search, from, to });
  return res.json(result);
});

const getActivityActions = asyncHandler(async (req, res) => {
  return res.json(await listActions());
});

module.exports = { getActivityLog, getActivityActions };

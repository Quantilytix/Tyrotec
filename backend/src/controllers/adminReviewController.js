const asyncHandler = require('../utils/asyncHandler');
const { listPendingReviews, resolveReview } = require('../services/adminReviewService');
const { logActivity } = require('../services/activityLogService');

// Admin/sales_rep only: the exception queue -- everything the automated
// PayFast/stock-reservation path couldn't handle on its own (stock_short,
// high_value, new_customer), worked independently of the existing admin
// Orders/Payments pages.
const getReviews = asyncHandler(async (req, res) => {
  const data = await listPendingReviews();
  return res.json(data);
});

const resolve = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { action } = req.body;

  const result = await resolveReview(id, action, req.user.id);
  if (result.error) return res.status(result.status).json({ error: result.error });

  await logActivity({
    actorId: req.user.id,
    actorRole: req.user.role,
    actorLabel: req.user.company_name || req.user.email,
    action: 'review.resolved',
    entityType: 'admin_review',
    entityId: id,
    description: `${req.user.company_name || req.user.email} resolved a "${result.reason}" review on order #${result.orderNumber} with action "${action}".`,
  });

  return res.json({ message: 'Review resolved', ...result });
});

module.exports = { getReviews, resolve };

const supabase = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const { logForUser } = require('../services/activityLogService');
const { discountLabel } = require('../utils/discounts');
const { validateDiscountInput, createDiscount, endDiscount, listDiscounts } = require('../services/discountService');

// Admin only (enforced at the route): discounts change what customers pay.

const getDiscounts = asyncHandler(async (req, res) => {
  return res.json(await listDiscounts());
});

const postDiscount = asyncHandler(async (req, res) => {
  const { value, error: invalid } = validateDiscountInput(req.body);
  if (invalid) return res.status(400).json({ error: invalid });

  const result = await createDiscount(value, req.user.id);
  if (result.error) return res.status(result.status).json({ error: result.error });

  await logForUser(req.user, {
    action: 'discount.created',
    entityType: 'discount',
    entityId: result.id,
    description: `Put ${value.product_ids.length} product(s) on ${discountLabel(value.percent, value.reason)}` +
      `${value.ends_on ? `, until ${value.ends_on}` : ''}.`,
  });
  return res.status(201).json(result);
});

const postEndDiscount = asyncHandler(async (req, res) => {
  const { data: discount } = await supabase.from('discounts').select('percent, reason').eq('id', req.params.id).maybeSingle();
  const result = await endDiscount(req.params.id);
  if (result.error) return res.status(result.status).json({ error: result.error });

  await logForUser(req.user, {
    action: 'discount.ended',
    entityType: 'discount',
    entityId: req.params.id,
    description: `Ended the discount ${discount ? discountLabel(discount.percent, discount.reason) : ''}.`,
  });
  return res.json(result);
});

module.exports = { getDiscounts, postDiscount, postEndDiscount };

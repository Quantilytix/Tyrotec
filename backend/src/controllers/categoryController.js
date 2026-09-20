const asyncHandler = require('../utils/asyncHandler');
const categoryService = require('../services/categoryService');
const { logActivity } = require('../services/activityLogService');

// Any signed-in user: customers need the list for the catalogue's category
// filter, staff for the product form and the import review screen.
const getCategories = asyncHandler(async (req, res) => {
  return res.json(await categoryService.listCategories());
});

const createCategory = asyncHandler(async (req, res) => {
  const result = await categoryService.createCategory(req.body.name);
  if (result.error) return res.status(result.status).json({ error: result.error });

  await logActivity({
    actorId: req.user.id,
    actorRole: req.user.role,
    actorLabel: req.user.company_name || req.user.email,
    action: 'product_category.created',
    entityType: 'product_category',
    entityId: result.category.id,
    description: `${req.user.company_name || req.user.email} added the product category "${result.category.name}".`,
  });

  return res.status(201).json(result.category);
});

// Removes the category from the list of choices only. Products already
// carrying it keep their category text (see 022_product_categories.sql), so
// nothing disappears from the catalogue.
const deleteCategory = asyncHandler(async (req, res) => {
  const categories = await categoryService.listCategories();
  const category = categories.find((c) => c.id === req.params.id);

  const result = await categoryService.deleteCategory(req.params.id);
  if (result.error) return res.status(result.status).json({ error: result.error });

  await logActivity({
    actorId: req.user.id,
    actorRole: req.user.role,
    actorLabel: req.user.company_name || req.user.email,
    action: 'product_category.deleted',
    entityType: 'product_category',
    entityId: req.params.id,
    description: `${req.user.company_name || req.user.email} removed the product category "${category?.name || req.params.id}".`,
  });

  return res.status(204).send();
});

module.exports = { getCategories, createCategory, deleteCategory };

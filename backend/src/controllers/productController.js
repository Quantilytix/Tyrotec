const crypto = require('crypto');
const path = require('path');
const supabase = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const { notifyInternalTeam } = require('../services/notificationService');
const { assertCategoryAllowed } = require('../services/categoryService');
const { LOW_STOCK_THRESHOLD } = require('../config/constants');

const PRODUCT_IMAGES_BUCKET = 'Product Images';

// Fires a low-stock notification to admin/sales_rep only on the crossing
// (previous stock was above the threshold, new stock isn't) -- not on every
// edit/order while a product stays low, which would spam the same alert
// repeatedly. Called wherever stock_quantity actually changes.
async function notifyIfLowStockCrossing(previousStock, product) {
  if (previousStock <= LOW_STOCK_THRESHOLD || product.stock_quantity > LOW_STOCK_THRESHOLD) return;

  const isOutOfStock = product.stock_quantity <= 0;
  await notifyInternalTeam({
    type: 'general',
    title: isOutOfStock ? 'Product out of stock' : 'Low stock alert',
    message: isOutOfStock
      ? `${product.name} (${product.sku}) is out of stock.`
      : `${product.name} (${product.sku}) is low on stock: ${product.stock_quantity} left.`,
    relatedType: 'product',
    relatedId: product.id,
  });
}

// Whitelisted so a request body can never set id/created_at/updated_at (or
// any other unexpected column) directly -- insert([req.body]) / update(req.body)
// would otherwise pass those straight through to Postgres, letting a caller
// rewrite a product's primary key via PATCH.
const WRITABLE_FIELDS = [
  'sku',
  'name',
  'category',
  'description',
  'unit_price',
  'stock_quantity',
  'availability',
  'lead_time_days',
  'min_order_qty',
  'image_url',
  'supplier_name',
  'supplier_location',
  'supplier_email',
  'supplier_phone',
  'supplier_cost',
];

function pickWritableFields(body) {
  const result = {};
  for (const field of WRITABLE_FIELDS) {
    if (body[field] !== undefined) result[field] = body[field];
  }
  return result;
}

// Admin/sales_rep only. Takes one multipart file (see the `upload` multer
// middleware on the route), puts it in the Product Images bucket under a
// random filename (never the original filename -- avoids collisions and
// path-injection from a hostile filename), and hands back its public URL.
// Doesn't touch the products table itself -- the frontend takes this URL
// and includes it as image_url in a normal createProduct/updateProduct call,
// same as if it had been typed in by hand.
const uploadProductImage = asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file provided' });

  const ext = path.extname(req.file.originalname) || '.jpg';
  const filename = `${crypto.randomUUID()}${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .upload(filename, req.file.buffer, {
      contentType: req.file.mimetype,
      upsert: false,
    });

  if (uploadError) return res.status(400).json({ error: uploadError.message });

  const { data } = supabase.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(filename);

  return res.status(201).json({ url: data.publicUrl });
});

// Product browsing: search by name/sku, filter by category, paginated.
// unit_price and stock_quantity are always included so customers can see
// price and availability up front.
const getAllProducts = asyncHandler(async (req, res) => {
  const { search, category, page = 1, limit = 20 } = req.query;
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const from = (pageNum - 1) * limitNum;
  const to = from + limitNum - 1;

  let query = supabase
    .from('products')
    .select('*', { count: 'exact' })
    .order('name', { ascending: true })
    .range(from, to);

  if (search) {
    // `,` `(` `)` are PostgREST's filter/grouping separators -- left
    // unescaped, a search term containing them can inject extra filter
    // conditions into this .or() clause. Strip them; a product search box
    // has no legitimate need for them anyway.
    const safeSearch = search.replace(/[,()]/g, '');
    query = query.or(`name.ilike.%${safeSearch}%,sku.ilike.%${safeSearch}%`);
  }
  if (category) {
    query = query.eq('category', category);
  }

  const { data, error, count } = await query;
  if (error) throw error;

  return res.json({ data, page: pageNum, limit: limitNum, total: count });
});

const getProductById = asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Product not found' });
  return res.json(data);
});

const createProduct = asyncHandler(async (req, res) => {
  const fields = pickWritableFields(req.body);

  const categoryProblem = await assertCategoryAllowed(fields.category);
  if (categoryProblem) return res.status(categoryProblem.status).json({ error: categoryProblem.error });

  const { data, error } = await supabase
    .from('products')
    .insert([fields])
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  return res.status(201).json(data);
});

const updateProduct = asyncHandler(async (req, res) => {
  const fields = pickWritableFields(req.body);

  // Only need the "before" values when stock or category are actually part of
  // this edit -- an extra read on every unrelated product edit (name, price,
  // etc.) would be wasted.
  let previousStock = null;
  let previousCategory = null;
  if (fields.stock_quantity !== undefined || fields.category !== undefined) {
    const { data: existing } = await supabase
      .from('products')
      .select('stock_quantity, category')
      .eq('id', req.params.id)
      .single();
    previousStock = fields.stock_quantity !== undefined ? existing?.stock_quantity ?? null : null;
    previousCategory = existing?.category ?? null;
  }

  // Products created before the managed category list exists keep categories
  // that aren't on it: re-saving such a product unchanged is fine, changing
  // its category means picking one from the list.
  if (fields.category !== undefined) {
    const categoryProblem = await assertCategoryAllowed(fields.category, previousCategory);
    if (categoryProblem) return res.status(categoryProblem.status).json({ error: categoryProblem.error });
  }

  const { data, error } = await supabase
    .from('products')
    .update(fields)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Product not found' });

  if (previousStock !== null) {
    await notifyIfLowStockCrossing(previousStock, data);
  }

  return res.json(data);
});

const deleteProduct = asyncHandler(async (req, res) => {
  const { error, count } = await supabase
    .from('products')
    .delete({ count: 'exact' })
    .eq('id', req.params.id);

  if (error) {
    // 23503 = foreign key violation -- product is referenced by existing
    // quote_items/order_items, so it can't be hard-deleted.
    if (error.code === '23503') {
      return res.status(409).json({
        error: "This product is referenced by existing quotes or orders and can't be deleted. Set its stock to 0 instead.",
      });
    }
    throw error;
  }

  if (!count) return res.status(404).json({ error: 'Product not found' });
  return res.status(204).send();
});

module.exports = {
  getAllProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  uploadProductImage,
  notifyIfLowStockCrossing,
};

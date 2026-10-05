const crypto = require('crypto');
const path = require('path');
const supabase = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const { notifyInternalTeam } = require('../services/notificationService');
const { assertCategoryAllowed } = require('../services/categoryService');
const { buildProductsWorkbook, sendWorkbook } = require('../services/exportService');
const { fetchAllRows } = require('../utils/exportQuery');
const { LOW_STOCK_THRESHOLD } = require('../config/constants');
const { logForUser } = require('../services/activityLogService');
const { formatCurrency } = require('../utils/formatCurrency');
const { isStaff } = require('../utils/roles');
const { publicProductView } = require('../services/stockService');

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
//
// Not here on purpose: stock_quantity and supplier_cost. Stock changes only
// through purchases, stock adjustments and orders, and supplier_cost is the
// weighted-average cost those purchases maintain (stockService.js). The
// supplier_* text fields are copied from the chosen supplier (supplier_id).
const WRITABLE_FIELDS = [
  'sku',
  'name',
  'category',
  'description',
  'unit_price',
  'vat_applicable',
  'availability',
  'lead_time_days',
  'min_order_qty',
  'image_url',
  'supplier_id',
];

// Describes what actually changed, field by field, so the audit log shows
// "Unit price R1 250,50 -> R1 400,00" rather than a bare "product updated".
// Money fields are formatted; everything else is printed as-is.
const MONEY_FIELDS = ['unit_price', 'supplier_cost'];
const FIELD_LABELS = {
  sku: 'SKU',
  name: 'Name',
  category: 'Category',
  unit_price: 'Unit price',
  vat_applicable: 'VAT applies',
  stock_quantity: 'Stock',
  availability: 'Availability',
  lead_time_days: 'Lead time',
  min_order_qty: 'Min order qty',
  supplier_name: 'Supplier',
  supplier_cost: 'Supplier cost',
};

function describeChanges(before, after) {
  const show = (field, value) => {
    if (value === null || value === undefined || value === '') return 'empty';
    if (MONEY_FIELDS.includes(field)) return formatCurrency(value);
    if (typeof value === 'boolean') return value ? 'yes' : 'no';
    return String(value);
  };

  return Object.keys(FIELD_LABELS)
    .filter((field) => after[field] !== undefined && String(before?.[field] ?? '') !== String(after[field] ?? ''))
    .map((field) => `${FIELD_LABELS[field]} ${show(field, before?.[field])} -> ${show(field, after[field])}`);
}

function pickWritableFields(body) {
  const result = {};
  for (const field of WRITABLE_FIELDS) {
    if (body[field] !== undefined) result[field] = body[field];
  }
  return result;
}

// Resolves supplier_id into the plain-text supplier copies products carry.
// Returns { fields } or { error, status }.
async function withSupplierCopies(fields) {
  if (fields.supplier_id === undefined) return { fields };
  if (fields.supplier_id === null || fields.supplier_id === '') {
    return { error: 'Choose a supplier for this product.', status: 400 };
  }
  const { data: supplier } = await supabase
    .from('suppliers')
    .select('id, name, location, email, phone, is_active')
    .eq('id', fields.supplier_id)
    .maybeSingle();
  if (!supplier) return { error: 'Supplier not found.', status: 400 };
  if (!supplier.is_active) return { error: `${supplier.name} is inactive. Choose an active supplier.`, status: 400 };
  return {
    fields: {
      ...fields,
      supplier_name: supplier.name,
      supplier_location: supplier.location,
      supplier_email: supplier.email,
      supplier_phone: supplier.phone,
    },
  };
}

// Customers get the catalogue view only: never supplier details or costs.
function viewFor(user, product) {
  return isStaff(user?.role) ? product : publicProductView(product);
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

  return res.json({ data: (data || []).map((product) => viewFor(req.user, product)), page: pageNum, limit: limitNum, total: count });
});

// Admin/sales_rep only. The same search and category filters as the product
// list, but every matching product rather than the current page -- staff
// export what they're looking at.
const exportProducts = asyncHandler(async (req, res) => {
  const { search, category } = req.query;

  const products = await fetchAllRows(() => {
    let query = supabase.from('products').select('*').order('name', { ascending: true });

    if (search) {
      // Same separator stripping as getAllProducts -- see the comment there.
      const safeSearch = String(search).replace(/[,()]/g, '');
      query = query.or(`name.ilike.%${safeSearch}%,sku.ilike.%${safeSearch}%`);
    }
    if (category) query = query.eq('category', category);

    return query;
  });

  await logForUser(req.user, {
    action: 'data.exported',
    entityType: 'products',
    description: `Exported ${products.length} product(s) to Excel${category ? ` (category: ${category})` : ''}${search ? ` (search: "${search}")` : ''}.`,
  });

  return sendWorkbook(res, buildProductsWorkbook(products), 'products');
});

const getProductById = asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Product not found' });
  return res.json(viewFor(req.user, data));
});

// New products start with no stock: it arrives through a purchase.
const createProduct = asyncHandler(async (req, res) => {
  const resolved = await withSupplierCopies(pickWritableFields(req.body));
  if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
  const fields = { ...resolved.fields, stock_quantity: 0 };

  const categoryProblem = await assertCategoryAllowed(fields.category);
  if (categoryProblem) return res.status(categoryProblem.status).json({ error: categoryProblem.error });

  const { data, error } = await supabase
    .from('products')
    .insert([fields])
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  await logForUser(req.user, {
    action: 'product.created',
    entityType: 'product',
    entityId: data.id,
    description: `Added product ${data.name} (${data.sku}) at ${formatCurrency(data.unit_price)} excl. VAT${data.supplier_name ? `, supplier ${data.supplier_name}` : ''}.`,
  });

  return res.status(201).json(data);
});

const updateProduct = asyncHandler(async (req, res) => {
  const resolved = await withSupplierCopies(pickWritableFields(req.body));
  if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
  const { fields } = resolved;

  // Read the row first: the audit entry records what each field changed from.
  const { data: existing } = await supabase
    .from('products')
    .select('*')
    .eq('id', req.params.id)
    .single();

  const previousCategory = existing?.category ?? null;

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

  const changes = describeChanges(existing, fields);
  if (changes.length > 0) {
    await logForUser(req.user, {
      action: 'product.updated',
      entityType: 'product',
      entityId: data.id,
      description: `Updated ${data.name} (${data.sku}): ${changes.join('; ')}.`,
    });
  }

  return res.json(data);
});

const deleteProduct = asyncHandler(async (req, res) => {
  const { data: existing } = await supabase.from('products').select('sku, name').eq('id', req.params.id).maybeSingle();

  const { error, count } = await supabase
    .from('products')
    .delete({ count: 'exact' })
    .eq('id', req.params.id);

  if (error) {
    // 23503 = foreign key violation -- product is referenced by existing
    // quote_items/order_items, so it can't be hard-deleted.
    if (error.code === '23503') {
      return res.status(409).json({
        error: "This product is on existing quotes, orders or purchases and can't be deleted.",
      });
    }
    throw error;
  }

  if (!count) return res.status(404).json({ error: 'Product not found' });

  await logForUser(req.user, {
    action: 'product.deleted',
    entityType: 'product',
    entityId: req.params.id,
    description: `Deleted product ${existing?.name || 'unknown'} (${existing?.sku || req.params.id}).`,
  });

  return res.status(204).send();
});

module.exports = {
  getAllProducts,
  exportProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  uploadProductImage,
  notifyIfLowStockCrossing,
};

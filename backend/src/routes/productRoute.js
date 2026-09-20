const express = require('express');
const multer = require('multer');
const { body } = require('express-validator');
const router = express.Router();
const {
  getAllProducts,
  exportProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  uploadProductImage,
} = require('../controllers/productController');
const { extractProductImport, confirmImport } = require('../controllers/productImportController');
const { getCategories, createCategory, deleteCategory } = require('../controllers/categoryController');
const { authenticateToken, requireRole } = require('../middleware/auth');
const validate = require('../middleware/validate');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files are allowed'));
    cb(null, true);
  },
});

// multer's own errors (bad file type from fileFilter, LIMIT_FILE_SIZE, etc.)
// have no `.status`, so the app-wide errorHandler would genericize them to a
// 500 "Internal server error" -- these are client input problems, not server
// bugs, so surface the real message as a 400 instead.
function handleUpload(req, res, next) {
  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}

// Broader than the image-only `upload` above -- this one also accepts the
// receipt/spreadsheet formats the import flow reads (Gemini handles images
// and PDFs directly; .xlsx/.csv get parsed locally first, see
// productImportController.js).
const IMPORT_MIMETYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
];
const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/') && !IMPORT_MIMETYPES.includes(file.mimetype)) {
      return cb(new Error('Only images, PDF, .xlsx, or .csv files are allowed'));
    }
    cb(null, true);
  },
});
function handleImportUpload(req, res, next) {
  importUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}

const createProductRules = [
  body('sku').isString().notEmpty(),
  body('name').isString().notEmpty(),
  body('category').isString().notEmpty(),
  body('unit_price').isFloat({ min: 0 }),
  body('vat_applicable').optional().isBoolean(),
  body('stock_quantity').isInt({ min: 0 }),
  body('availability').isIn(['local', 'national', 'global']),
  body('lead_time_days').isInt({ min: 0 }),
  body('min_order_qty').isInt({ min: 1 }),
  body('supplier_name').isString().notEmpty(),
  body('supplier_location').isString().notEmpty(),
  body('supplier_phone').isString().notEmpty(),
  body('supplier_email').optional({ values: 'falsy' }).isEmail(),
  body('supplier_cost').optional({ values: 'falsy' }).isFloat({ min: 0 }),
];

const updateProductRules = [
  body('sku').optional().isString().notEmpty(),
  body('name').optional().isString().notEmpty(),
  body('category').optional().isString().notEmpty(),
  body('unit_price').optional().isFloat({ min: 0 }),
  body('vat_applicable').optional().isBoolean(),
  body('stock_quantity').optional().isInt({ min: 0 }),
  body('availability').optional().isIn(['local', 'national', 'global']),
  body('lead_time_days').optional().isInt({ min: 0 }),
  body('min_order_qty').optional().isInt({ min: 1 }),
  body('supplier_name').optional().isString().notEmpty(),
  body('supplier_location').optional().isString().notEmpty(),
  body('supplier_phone').optional().isString().notEmpty(),
  body('supplier_email').optional({ values: 'falsy' }).isEmail(),
  body('supplier_cost').optional({ values: 'falsy' }).isFloat({ min: 0 }),
];

router.post(
  '/upload-image',
  authenticateToken,
  requireRole(['admin', 'sales_rep']),
  handleUpload,
  uploadProductImage
);
router.post(
  '/import/extract',
  authenticateToken,
  requireRole(['admin', 'sales_rep']),
  handleImportUpload,
  extractProductImport
);
router.post('/import/confirm', authenticateToken, requireRole(['admin', 'sales_rep']), confirmImport);

// Before '/:id', or "categories" is read as a product id.
router.get('/categories', authenticateToken, getCategories);
router.post(
  '/categories',
  authenticateToken,
  requireRole(['admin', 'sales_rep']),
  body('name').isString().trim().notEmpty().withMessage('A category name is required'),
  validate,
  createCategory
);
router.delete('/categories/:id', authenticateToken, requireRole(['admin', 'sales_rep']), deleteCategory);

// Also before '/:id', same reason as the category routes above.
router.get('/export', authenticateToken, requireRole(['admin', 'sales_rep']), exportProducts);

router.get('/', authenticateToken, getAllProducts);
router.get('/:id', authenticateToken, getProductById);
router.post('/', authenticateToken, requireRole(['admin', 'sales_rep']), createProductRules, validate, createProduct);
router.patch('/:id', authenticateToken, requireRole(['admin', 'sales_rep']), updateProductRules, validate, updateProduct);
router.delete('/:id', authenticateToken, requireRole(['admin', 'sales_rep']), deleteProduct);

module.exports = router;

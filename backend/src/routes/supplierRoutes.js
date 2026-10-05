const express = require('express');
const router = express.Router();
const { listSuppliers, createSupplier, updateSupplier } = require('../controllers/supplierController');
const { authenticateToken, requireRole } = require('../middleware/auth');

router.get('/', authenticateToken, requireRole(['admin', 'sales_rep']), listSuppliers);
router.post('/', authenticateToken, requireRole(['admin', 'sales_rep']), createSupplier);
router.patch('/:id', authenticateToken, requireRole(['admin', 'sales_rep']), updateSupplier);

module.exports = router;

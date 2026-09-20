const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const {
  getStaff,
  getInvites,
  inviteStaff,
  revokeInvite,
  changeRole,
  changeStatus,
  removeStaff,
} = require('../controllers/staffController');
const { authenticateToken, requireRole } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { INVITABLE_ROLES, SETTABLE_STATUSES } = require('../services/staffService');

// Reading the staff list and inviting people is an admin job; changing what
// someone *is* -- their role, whether they can sign in at all, or removing
// them -- is reserved for super admins. requireRole ranks roles, so 'admin'
// here also admits a super admin.
router.get('/', authenticateToken, requireRole(['admin']), getStaff);

router.get('/invites', authenticateToken, requireRole(['admin']), getInvites);
router.post(
  '/invites',
  authenticateToken,
  requireRole(['admin']),
  body('email').isEmail().withMessage('A valid email is required').normalizeEmail(),
  body('role').isIn(INVITABLE_ROLES).withMessage('Pick a valid staff role'),
  body('full_name').optional({ values: 'falsy' }).isString(),
  validate,
  inviteStaff
);
router.delete('/invites/:id', authenticateToken, requireRole(['admin']), revokeInvite);

router.patch(
  '/:id/role',
  authenticateToken,
  requireRole(['super_admin']),
  body('role').isIn(INVITABLE_ROLES).withMessage('Pick a valid staff role'),
  validate,
  changeRole
);
router.patch(
  '/:id/status',
  authenticateToken,
  requireRole(['super_admin']),
  body('status').isIn(SETTABLE_STATUSES),
  validate,
  changeStatus
);
router.delete('/:id', authenticateToken, requireRole(['super_admin']), removeStaff);

module.exports = router;

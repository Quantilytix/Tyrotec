const express = require('express');
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const {
  register,
  login,
  oauthComplete,
  getMe,
  updateMe,
  forgotPassword,
  resetPassword,
  getPendingStaffAdmin,
  reviewStaffSignupAdmin,
} = require('../controllers/authController');
const { acceptInvite } = require('../controllers/staffController');
const { authenticateToken, requireRole } = require('../middleware/auth');
const validate = require('../middleware/validate');

const emailPasswordRules = [
  body('email').isEmail().withMessage('A valid email is required').normalizeEmail(),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
];

const registerRules = [
  ...emailPasswordRules,
  // Staff accounts are invite-only now (services/staffService.js), so the
  // public signup endpoint only ever creates customers.
  body('role').optional().isIn(['customer']).withMessage('Staff accounts are created by invitation only'),
  // { values: 'falsy' } matters here, not just style: Register.jsx always
  // sends full_name/phone/vat_number as an explicit `null` (not an omitted
  // key) when left blank -- express-validator's default .optional() only
  // skips validation for an *absent* field (undefined), not one explicitly
  // set to null, so plain .optional().isString() rejected every customer
  // signup that left any of these blank with a bare "Invalid value".
  body('full_name').optional({ values: 'falsy' }).isString(),
  body('phone').optional({ values: 'falsy' }).isString(),
  body('vat_number').optional({ values: 'falsy' }).isString(),
  body('is_vat_registered').optional().isBoolean(),
];

// Only guards the credential-guessing surface (register/login). Scoped here
// rather than at the app.js router mount so it doesn't also throttle /me,
// which every page load hits to verify the stored session, or /staff/*,
// which is already gated behind an authenticated admin.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  // Default express-rate-limit response is plain text, which the frontend's
  // `err.response?.data?.error` handling can't read -- send JSON so the real
  // reason ("too many attempts") actually reaches the user instead of a
  // generic "something went wrong".
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});

router.post('/register', authLimiter, registerRules, validate, register);
router.post('/login', authLimiter, emailPasswordRules, validate, login);
router.post(
  '/oauth-complete',
  authLimiter,
  body('access_token').isString().notEmpty(),
  validate,
  oauthComplete
);
router.post(
  '/forgot-password',
  authLimiter,
  body('email').isEmail().withMessage('A valid email is required').normalizeEmail(),
  validate,
  forgotPassword
);
router.post(
  '/reset-password',
  authLimiter,
  body('access_token').isString().notEmpty(),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  validate,
  resetPassword
);
const updateMeRules = [
  body('phone').optional({ values: 'falsy' }).isString(),
  body('company_name').optional({ values: 'falsy' }).isString(),
  body('full_name').optional({ values: 'falsy' }).isString(),
  body('vat_number').optional({ values: 'falsy' }).isString(),
  body('is_vat_registered').optional().isBoolean(),
  body('address').optional({ values: 'falsy' }).isString(),
];

// Public: an invited staff member sets their password using the token from
// their invitation link. Rate-limited like the other credential endpoints.
router.post(
  '/staff/accept-invite',
  authLimiter,
  body('token').isString().notEmpty(),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('full_name').optional({ values: 'falsy' }).isString(),
  validate,
  acceptInvite
);

router.get('/me', authenticateToken, getMe);
router.patch('/me', authenticateToken, updateMeRules, validate, updateMe);
router.get('/staff/pending', authenticateToken, requireRole(['admin']), getPendingStaffAdmin);
router.patch(
  '/staff/:id/status',
  authenticateToken,
  requireRole(['admin']),
  body('status').isIn(['approved', 'rejected']),
  validate,
  reviewStaffSignupAdmin
);

module.exports = router;

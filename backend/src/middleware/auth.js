const supabase = require('../config/supabase');
const { PROFILE_FIELDS } = require('../utils/userProfileFields');
const { satisfiesRole } = require('../utils/roles');

// Verifies the Supabase Auth access token sent as "Authorization: Bearer <token>"
// and attaches the caller's profile (id, email, role, company_name) to req.user.
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Missing access token' });
  }

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select(PROFILE_FIELDS)
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return res.status(403).json({ error: 'User profile not found' });
    }

    // Catches a status change taking effect mid-session (e.g. a suspension
    // after the account already holds a valid token), not just at the next
    // login -- login() only checks status at sign-in time. A suspended staff
    // member loses access on their very next request, not whenever their
    // token happens to expire.
    if (profile.status !== 'approved') {
      return res.status(403).json({ error: 'Your account is not active.' });
    }

    req.user = profile;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

// For pages a visitor can use without an account (browsing products, Help):
// no token means a guest (req.user stays undefined); a token is checked
// exactly as authenticateToken does, so a signed-in caller still gets their
// own view (staff see costs, customers don't).
const optionalAuth = (req, res, next) => {
  if (!req.headers['authorization']) return next();
  return authenticateToken(req, res, next);
};

// Roles are ranked (utils/roles.js): requireRole(['admin']) also admits a
// super admin, without every route having to list both.
const requireRole = (allowedRoles = []) => {
  return (req, res, next) => {
    if (!req.user || !satisfiesRole(req.user.role, allowedRoles)) {
      return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
    }
    next();
  };
};

module.exports = { authenticateToken, optionalAuth, requireRole };

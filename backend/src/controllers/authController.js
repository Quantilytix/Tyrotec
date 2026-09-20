const supabase = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const { notifyUser, notifyInternalTeam, sendEmail } = require('../services/notificationService');
const { normalizePhone, findUserByPhone } = require('../services/whatsappConversationService');
const { logActivity, logForUser } = require('../services/activityLogService');
const { PROFILE_FIELDS } = require('../utils/userProfileFields');

// Public self-registration: customers only, with immediate access. Staff
// accounts are never created here -- they come from an invitation an admin
// sends (services/staffService.js), which is also what makes the role
// trustworthy: nobody can ask to be staff.
const register = asyncHandler(async (req, res) => {
  const { email, password, company_name, full_name, role, phone, vat_number, is_vat_registered } = req.body;
  const requestedRole = role || 'customer';

  // Staff accounts are invite-only (services/staffService.js): the public
  // signup endpoint can only ever create a customer.
  if (requestedRole !== 'customer') {
    return res.status(400).json({ error: 'Staff accounts are created by invitation only.' });
  }

  // VAT registration doesn't change what they're charged -- Tyrotec charges
  // VAT on standard-rated goods either way -- but a registered customer can
  // only claim it back if their VAT number is on the document, so it's
  // required once they say they're registered.
  const vatRegistered = is_vat_registered === true;
  if (vatRegistered && !String(vat_number || '').trim()) {
    return res.status(400).json({ error: 'A VAT number is required for a VAT-registered business.' });
  }
  // Optional, but if given it must not already belong to someone -- most
  // often a WhatsApp-created account (self-serve signup in the chat) whose
  // owner is now registering for real: they should log in / recover that
  // account instead of silently colliding with the phone unique constraint
  // as a raw 500.
  const normalizedPhone = phone ? normalizePhone(phone) : null;
  if (normalizedPhone) {
    const existingByPhone = await findUserByPhone(normalizedPhone);
    if (existingByPhone) {
      return res.status(400).json({
        error: 'That phone number is already linked to an account. Log in instead, or use "Forgot password?".',
      });
    }
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { company_name: company_name || null, full_name: full_name || null, role: 'customer' },
  });

  if (error) return res.status(400).json({ error: error.message });

  // A DB trigger normally creates this row from the auth user's metadata,
  // but relying on it alone is a race: if this SELECT runs before the
  // trigger commits, registration fails with the auth account already
  // created and no profile to show for it -- an orphaned account that can
  // neither register again (email taken) nor log in (no profile). Upserting
  // here directly makes registration correct regardless of trigger timing.
  const { data: profile, error: profileError } = await supabase
    .from('users')
    .upsert(
      {
        id: data.user.id,
        email,
        company_name: company_name || null,
        full_name: full_name || null,
        role: 'customer',
        status: 'approved',
        phone: normalizedPhone,
        vat_number: vat_number || null,
        is_vat_registered: vatRegistered,
      },
      { onConflict: 'id' }
    )
    .select(PROFILE_FIELDS)
    .single();

  if (profileError) return res.status(500).json({ error: profileError.message });

  return res.status(201).json({ message: 'User created successfully', user: profile });
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // Use a throwaway client here, not the shared `supabase` -- see the
  // warning in config/supabase.js for why signing in on the shared instance
  // is unsafe.
  const { data, error } = await supabase.createScopedClient().auth.signInWithPassword({ email, password });

  if (error || !data.session) {
    // Recorded so repeated attempts on a real account are visible in the audit
    // log. The role is looked up so the entry lands in the right view (a
    // failed staff sign-in is staff activity); unknown emails log as 'system'
    // rather than inventing an actor.
    const { data: attempted } = await supabase
      .from('users')
      .select('id, role')
      .eq('email', String(email || '').toLowerCase())
      .maybeSingle();

    await logActivity({
      actorId: attempted?.id || null,
      actorRole: attempted?.role || 'system',
      actorLabel: email,
      action: 'auth.login_failed',
      entityType: 'user',
      entityId: attempted?.id || null,
      description: `Failed sign-in attempt for ${email}.`,
    });

    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select(PROFILE_FIELDS)
    .eq('id', data.user.id)
    .single();

  if (profileError || !profile) {
    return res.status(500).json({ error: 'User profile not found' });
  }

  if (profile.status === 'pending') {
    return res.status(403).json({ error: 'Your account is awaiting admin approval.' });
  }
  if (profile.status === 'rejected') {
    return res.status(403).json({ error: 'Your signup request was not approved.' });
  }
  if (profile.status === 'suspended') {
    return res.status(403).json({ error: 'This account has been suspended. Contact an administrator.' });
  }

  await logForUser(profile, {
    action: 'auth.login',
    entityType: 'user',
    entityId: profile.id,
    description: `${profile.company_name || profile.full_name || profile.email} signed in.`,
  });

  return res.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
    user: profile,
  });
});

// Called by the frontend's /auth/callback page right after Google Sign-In
// completes -- the browser already has a real Supabase session at that point
// (obtained directly from Supabase, not through this backend), this just
// makes sure a matching public.users profile exists and is usable, the same
// way register() does for a plain email/password signup.
const oauthComplete = asyncHandler(async (req, res) => {
  const { access_token } = req.body;
  if (!access_token) return res.status(400).json({ error: 'Missing access token.' });

  // Scoped client, not the shared one -- same reason every other "verify a
  // token I didn't issue myself" call in this file uses one.
  const { data: { user }, error } = await supabase.createScopedClient().auth.getUser(access_token);
  if (error || !user) return res.status(401).json({ error: 'Invalid or expired session.' });

  let { data: profile } = await supabase
    .from('users')
    .select(PROFILE_FIELDS)
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) {
    // Brand new person signing in with Google for the first time -- same
    // defaults as a normal self-registration. Deliberately only reached
    // when no row exists yet: an existing account (found above) is never
    // touched here, so this can't accidentally reset someone's role/status.
    const { data: created, error: createErr } = await supabase
      .from('users')
      .upsert(
        {
          id: user.id,
          email: user.email,
          full_name: user.user_metadata?.full_name || user.user_metadata?.name || null,
          role: 'customer',
          status: 'approved',
        },
        { onConflict: 'id' }
      )
      .select(PROFILE_FIELDS)
      .single();

    if (createErr) return res.status(500).json({ error: createErr.message });
    profile = created;
  }

  if (profile.status === 'pending') {
    return res.status(403).json({ error: 'Your account is awaiting admin approval.' });
  }
  if (profile.status === 'rejected') {
    return res.status(403).json({ error: 'Your signup request was not approved.' });
  }

  return res.json({ user: profile });
});

const getMe = asyncHandler(async (req, res) => {
  return res.json({ user: req.user });
});

// Lets a customer edit their own profile -- company name, contact name,
// phone (also the only way an existing account that predates the WhatsApp
// feature, or just never set a number, can link WhatsApp), VAT number, and
// address (the last two feed the "professional" quote PDF). Every field is
// optional and only touches what's actually provided -- req.body.foo left
// out of the request entirely (undefined) leaves that column alone; an
// empty string clears it. Email is deliberately not editable here -- that's
// the account's real identity (tied to the Supabase Auth user), changing it
// needs its own re-verification flow this endpoint doesn't attempt.
const updateMe = asyncHandler(async (req, res) => {
  const { phone, company_name, full_name, vat_number, is_vat_registered, address } = req.body;

  const patch = {};
  if (company_name !== undefined) patch.company_name = company_name || null;
  if (full_name !== undefined) patch.full_name = full_name || null;
  if (vat_number !== undefined) patch.vat_number = vat_number || null;
  if (address !== undefined) patch.address = address || null;

  if (is_vat_registered !== undefined) {
    patch.is_vat_registered = is_vat_registered === true;
    // Same rule as registration: claiming to be registered means the VAT
    // number has to be on file, whether it arrives in this request or is
    // already stored.
    if (patch.is_vat_registered) {
      const vatNumber = vat_number !== undefined ? vat_number : req.user.vat_number;
      if (!String(vatNumber || '').trim()) {
        return res.status(400).json({ error: 'A VAT number is required for a VAT-registered business.' });
      }
    }
  }

  if (phone !== undefined) {
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) return res.status(400).json({ error: 'That phone number doesn\'t look valid.' });

    const existing = await findUserByPhone(normalizedPhone);
    if (existing && existing.id !== req.user.id) {
      return res.status(400).json({ error: 'That phone number is already linked to another account.' });
    }
    patch.phone = normalizedPhone;
  }

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'Nothing to update.' });
  }

  const { data, error } = await supabase
    .from('users')
    .update(patch)
    .eq('id', req.user.id)
    .select(PROFILE_FIELDS)
    .single();

  if (error) return res.status(400).json({ error: error.message });
  return res.json({ user: data });
});

// Always responds the same way regardless of whether the email exists --
// otherwise this endpoint becomes a way to check which emails are
// registered. Supabase sends its own reset email (styled/routed via
// whatever's configured in the Supabase project's Auth settings, separate
// from this app's own SMTP_* notification emails) with a link back to
// FRONTEND_URL/reset-password carrying a recovery token in the URL fragment.
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const redirectTo = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password`;

  // Scoped client, not the shared one -- same reason login() uses one: this
  // is an auth-state-changing call and must never run on the client every
  // other request in this process relies on staying at service_role.
  await supabase.createScopedClient().auth.resetPasswordForEmail(email, { redirectTo });

  return res.json({ message: 'If that email is registered, a reset link has been sent.' });
});

// The frontend reads the recovery access_token out of the URL fragment
// Supabase's reset link redirects to, and posts it here alongside the new
// password. getUser(token) verifies it's a real, current Supabase token and
// resolves the user id; admin.updateUserById actually sets the password.
// Both run without ever needing a Supabase client on the frontend, keeping
// this app's "frontend only ever talks to our own backend" architecture.
const resetPassword = asyncHandler(async (req, res) => {
  const { access_token, password } = req.body;
  if (!access_token) return res.status(400).json({ error: 'Missing or expired reset link.' });

  const { data: { user }, error: verifyErr } = await supabase.createScopedClient().auth.getUser(access_token);
  if (verifyErr || !user) return res.status(400).json({ error: 'This reset link is invalid or has expired.' });

  const { error: updateErr } = await supabase.auth.admin.updateUserById(user.id, { password });
  if (updateErr) return res.status(400).json({ error: updateErr.message });

  return res.json({ message: 'Password updated. You can now log in.' });
});

// Admin only: every pending staff signup request.
const getPendingStaffAdmin = asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, full_name, role, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) throw error;
  return res.json(data);
});

// Admin only. A signup can only be reviewed once -- already approved/rejected
// requests are final here (same guard shape as paymentController.js's
// updatePaymentStatus).
const reviewStaffSignupAdmin = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: "Status must be 'approved' or 'rejected'." });
  }

  const { data: target, error: findErr } = await supabase
    .from('users')
    .select('id, email, full_name, status')
    .eq('id', id)
    .single();

  if (findErr || !target) return res.status(404).json({ error: 'Signup request not found' });

  if (target.status !== 'pending') {
    return res.status(400).json({ error: `This request is already "${target.status}" and can't be reviewed again.` });
  }

  const { error } = await supabase.from('users').update({ status }).eq('id', id);
  if (error) throw error;

  if (status === 'approved') {
    await notifyUser({
      userId: target.id,
      type: 'general',
      title: 'Account approved',
      message: 'Your staff account has been approved. You can now log in to the Customer Portal.',
      relatedType: 'staff_signup',
      relatedId: id,
      email: target.email,
    });
  } else {
    // Rejected accounts can never log in, so an in-app notification would
    // never be seen -- email is the only channel that reaches them.
    await sendEmail(
      target.email,
      'Signup request not approved',
      'Your request for a staff account was not approved. Contact us if you have questions.'
    );
  }

  await logActivity({
    actorId: req.user.id,
    actorRole: req.user.role,
    actorLabel: req.user.company_name || req.user.email,
    action: 'staff_signup.reviewed',
    entityType: 'user',
    entityId: id,
    description: `${req.user.company_name || req.user.email} ${status} the staff signup request from ${target.full_name || target.email}.`,
  });

  return res.json({ message: 'Signup request updated', id, status });
});

module.exports = {
  register,
  login,
  oauthComplete,
  getMe,
  updateMe,
  forgotPassword,
  resetPassword,
  getPendingStaffAdmin,
  reviewStaffSignupAdmin,
};

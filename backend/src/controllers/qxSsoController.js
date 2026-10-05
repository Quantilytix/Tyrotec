const supabase = require('../config/supabase');
const asyncHandler = require('../utils/asyncHandler');
const { PROFILE_FIELDS } = require('../utils/userProfileFields');
const { isStaff } = require('../utils/roles');
const { logForUser, logActivity } = require('../services/activityLogService');
const { qxConfig } = require('../services/qxSyncService');

const EXCHANGE_TIMEOUT_MS = 15 * 1000;

// What QX's /sso/exchange refusals mean for the person signing in.
const QX_REFUSALS = {
  invalid_code: { status: 401, error: 'This sign-in link has expired or was already used. Open the portal from QX again.' },
  access_removed: { status: 403, error: "Your QX account no longer has access to the portal. Ask your QX admin." },
  no_email: { status: 403, error: 'Your QX account has no email address, so it can\'t be matched to a portal account.' },
};

// Escapes LIKE wildcards so an email is matched literally (case-insensitively).
const likeLiteral = (value) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

async function exchangeCodeWithQx(config, code, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXCHANGE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${config.url}/sso/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': config.key },
      body: JSON.stringify({ code }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

// POST /api/auth/qx-sso   body: { code }
//
// Second half of "Open Tyrotec Portal" in QX: QX sent the browser here with a
// one-time code. The code is redeemed with QX server-to-server (with this
// portal's QX key, which the browser never sees), QX says which of its users
// clicked, and that person is signed in -- but only if their email belongs to
// an approved staff account here. Never creates an account, never signs in a
// customer.
const qxSso = asyncHandler(async (req, res) => {
  const config = qxConfig();
  if (!config) return res.status(503).json({ error: 'Signing in from QX is not set up on this portal.' });

  let exchange;
  try {
    exchange = await exchangeCodeWithQx(config, String(req.body.code));
  } catch (err) {
    console.error('QX sign-in exchange failed:', err.message || err);
    return res.status(502).json({ error: "Couldn't reach QX to confirm your sign-in. Try again in a minute." });
  }

  if (exchange.status !== 200 || !exchange.body?.user?.email) {
    const refusal = QX_REFUSALS[exchange.body?.code];
    if (refusal) return res.status(refusal.status).json({ error: refusal.error });
    console.error('QX sign-in exchange refused:', exchange.status, exchange.body?.error);
    return res.status(502).json({ error: 'QX could not confirm your sign-in. Try again from QX.' });
  }

  const qxUser = exchange.body.user;
  const email = String(qxUser.email).trim().toLowerCase();
  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select(PROFILE_FIELDS)
    .ilike('email', likeLiteral(email))
    .maybeSingle();
  if (profileError) throw profileError;

  if (!profile || !isStaff(profile.role) || profile.status !== 'approved') {
    await logActivity({
      actorId: profile?.id || null,
      actorRole: profile?.role || 'system',
      actorLabel: email,
      action: 'auth.qx_sso_refused',
      entityType: 'user',
      entityId: profile?.id || null,
      description: `Sign-in from QX refused for ${email}: ${!profile ? 'no portal account' : !isStaff(profile.role) ? 'not a staff account' : `account is ${profile.status}`}.`,
    });
    return res.status(403).json({
      error: !profile || !isStaff(profile.role)
        ? `There's no staff account on the portal for ${email}. Ask a portal admin to invite you with this email.`
        : 'Your portal account is not active. Contact a portal administrator.',
    });
  }

  // The first sign-in from QX links this account to that QX user; after that
  // only they can use it from QX. QX doesn't verify email changes, so the
  // email alone isn't enough once someone has signed in this way.
  const qxUserId = String(qxUser.qx_user_id || '').trim();
  if (!qxUserId) {
    console.error('QX sign-in exchange returned no qx_user_id');
    return res.status(502).json({ error: 'QX could not confirm your sign-in. Try again from QX.' });
  }
  const { data: linkRow, error: linkReadError } = await supabase
    .from('users').select('qx_user_id').eq('id', profile.id).maybeSingle();
  if (linkReadError) throw linkReadError;
  const linkedTo = linkRow?.qx_user_id || null;
  if (linkedTo && linkedTo !== qxUserId) {
    await logActivity({
      actorId: profile.id,
      actorRole: profile.role,
      actorLabel: email,
      action: 'auth.qx_sso_refused',
      entityType: 'user',
      entityId: profile.id,
      description: `Sign-in from QX refused for ${email}: this account is linked to a different QX user.`,
    });
    return res.status(403).json({
      error: 'This portal account is linked to a different QX user. Ask a portal administrator.',
    });
  }
  if (!linkedTo) {
    const { error: linkWriteError } = await supabase
      .from('users').update({ qx_user_id: qxUserId }).eq('id', profile.id).is('qx_user_id', null);
    if (linkWriteError) {
      if (linkWriteError.code === '23505') {
        return res.status(403).json({ error: 'Your QX account is already linked to another portal account. Ask a portal administrator.' });
      }
      throw linkWriteError;
    }
  }

  // Mint a normal Supabase session for them: a magic link is generated (not
  // emailed) and redeemed immediately on a throwaway client -- see
  // config/supabase.js for why never on the shared one.
  const { data: link, error: linkError } = await supabase.auth.admin.generateLink({ type: 'magiclink', email: profile.email });
  if (linkError || !link?.properties?.hashed_token) {
    console.error('QX sign-in: generateLink failed:', linkError?.message);
    return res.status(500).json({ error: 'Could not sign you in. Try again.' });
  }
  const { data: verified, error: verifyError } = await supabase
    .createScopedClient()
    .auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' });
  if (verifyError || !verified?.session) {
    console.error('QX sign-in: verifyOtp failed:', verifyError?.message);
    return res.status(500).json({ error: 'Could not sign you in. Try again.' });
  }

  await logForUser(profile, {
    action: 'auth.login_qx',
    entityType: 'user',
    entityId: profile.id,
    description: `${profile.full_name || profile.email} signed in from QX.`,
  });

  return res.json({
    access_token: verified.session.access_token,
    refresh_token: verified.session.refresh_token,
    expires_at: verified.session.expires_at,
    user: profile,
  });
});

module.exports = { qxSso, exchangeCodeWithQx, likeLiteral };

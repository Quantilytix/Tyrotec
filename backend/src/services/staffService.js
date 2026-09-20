// Staff accounts: invitations, the staff list, role changes and suspension.
//
// Staff accounts are invite-only (025_staff_invites_and_audit.sql). There is
// no public staff signup: an admin invites an email address with a role, and
// the account is created only when the invitee sets their password. That
// removes the old "anyone can queue a signup request" surface entirely, and
// makes the invite itself the approval step.

const crypto = require('crypto');
const supabase = require('../config/supabase');
const { PROFILE_FIELDS } = require('../utils/userProfileFields');
const { STAFF_ROLES } = require('../utils/roles');

const INVITE_TTL_DAYS = 7;
// Roles an admin may invite. Only a super admin can create another super
// admin, checked separately at the controller.
const INVITABLE_ROLES = ['sales_rep', 'admin', 'super_admin'];

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Every staff member, newest first, including pending and suspended accounts.
async function listStaff() {
  const { data, error } = await supabase
    .from('users')
    .select(`${PROFILE_FIELDS}, created_at`)
    .in('role', STAFF_ROLES)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

async function listInvites() {
  const { data, error } = await supabase
    .from('staff_invites')
    .select('id, email, full_name, role, expires_at, accepted_at, revoked_at, created_at, users:invited_by(email, company_name)')
    .order('created_at', { ascending: false });

  if (error) throw error;

  const now = Date.now();
  return (data || []).map((invite) => ({
    ...invite,
    status: invite.accepted_at
      ? 'accepted'
      : invite.revoked_at
        ? 'revoked'
        : new Date(invite.expires_at).getTime() < now
          ? 'expired'
          : 'open',
  }));
}

// Returns the invite plus the one-time link. The plain token is returned here
// and never stored, so it can be emailed or handed over -- after this response
// it is unrecoverable and a new invite must be sent instead.
async function createInvite({ email, fullName, role, invitedBy }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail) return { error: 'An email address is required.', status: 400 };
  if (!INVITABLE_ROLES.includes(role)) return { error: 'Pick a valid staff role.', status: 400 };

  const { data: existing } = await supabase
    .from('users')
    .select('id, role')
    .eq('email', cleanEmail)
    .maybeSingle();
  if (existing) {
    return { error: 'An account with that email already exists.', status: 409 };
  }

  // One open invite per address: re-inviting replaces the old link rather than
  // leaving two valid tokens for the same person.
  await supabase
    .from('staff_invites')
    .update({ revoked_at: new Date().toISOString() })
    .eq('email', cleanEmail)
    .is('accepted_at', null)
    .is('revoked_at', null);

  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: invite, error } = await supabase
    .from('staff_invites')
    .insert([
      {
        email: cleanEmail,
        full_name: fullName || null,
        role,
        token_hash: hashToken(token),
        invited_by: invitedBy,
        expires_at: expiresAt,
      },
    ])
    .select('id, email, full_name, role, expires_at')
    .single();

  if (error) throw error;

  const base = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
  return { invite, token, link: `${base}/staff/accept-invite?token=${token}` };
}

async function revokeInvite(id) {
  const { data, error } = await supabase
    .from('staff_invites')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .is('accepted_at', null)
    .select('id, email')
    .maybeSingle();

  if (error) throw error;
  if (!data) return { error: 'That invite was already accepted or does not exist.', status: 404 };
  return { invite: data };
}

// Creates the account the invite was for. Public endpoint: the token is the
// only credential, so it is checked for being unused, unrevoked and unexpired
// before anything is created.
async function acceptInvite({ token, password, fullName }) {
  const { data: invite, error } = await supabase
    .from('staff_invites')
    .select('*')
    .eq('token_hash', hashToken(String(token || '')))
    .maybeSingle();

  if (error) throw error;
  if (!invite) return { error: 'This invitation link is not valid.', status: 400 };
  if (invite.accepted_at) return { error: 'This invitation has already been used.', status: 400 };
  if (invite.revoked_at) return { error: 'This invitation has been cancelled.', status: 400 };
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return { error: 'This invitation has expired. Ask an administrator for a new one.', status: 400 };
  }

  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email: invite.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName || invite.full_name || null, role: invite.role },
  });
  if (createErr) return { error: createErr.message, status: 400 };

  // The signup trigger only ever creates a customer or a pending sales rep
  // (021_security_hardening.sql), so the real role and an approved status are
  // set here, by the server, from the invite.
  const { data: profile, error: profileErr } = await supabase
    .from('users')
    .upsert(
      {
        id: created.user.id,
        email: invite.email,
        full_name: fullName || invite.full_name || null,
        role: invite.role,
        status: 'approved',
      },
      { onConflict: 'id' }
    )
    .select(PROFILE_FIELDS)
    .single();

  if (profileErr) return { error: profileErr.message, status: 500 };

  await supabase
    .from('staff_invites')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invite.id);

  return { profile, invite };
}

async function getStaffMember(id) {
  const { data, error } = await supabase
    .from('users')
    .select(PROFILE_FIELDS)
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function countSuperAdmins() {
  const { count, error } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'super_admin')
    .eq('status', 'approved');

  if (error) throw error;
  return count || 0;
}

// Guardrails shared by every change to a staff account. Locking yourself out,
// or removing the last super admin, leaves nobody able to administer the
// system -- which is only fixable with direct database access.
async function guardStaffChange(actor, target, { selfAction = false } = {}) {
  if (!target) return { error: 'Staff member not found', status: 404 };
  if (!STAFF_ROLES.includes(target.role)) return { error: 'That account is not a staff account.', status: 400 };
  if (!selfAction && target.id === actor.id) {
    return { error: "You can't change your own role or status.", status: 400 };
  }
  if (target.role === 'super_admin' && (await countSuperAdmins()) <= 1) {
    return { error: 'This is the last super admin. Promote someone else first.', status: 400 };
  }
  return null;
}

async function changeRole(actor, id, role) {
  if (!STAFF_ROLES.includes(role)) return { error: 'Pick a valid staff role.', status: 400 };

  const target = await getStaffMember(id);
  const problem = await guardStaffChange(actor, target);
  if (problem) return problem;
  if (target.role === role) return { error: `They are already ${role.replace('_', ' ')}.`, status: 400 };

  const { data, error } = await supabase
    .from('users')
    .update({ role })
    .eq('id', id)
    .select(PROFILE_FIELDS)
    .single();

  if (error) throw error;
  return { staff: data, previousRole: target.role };
}

// 'approved' reactivates (and is how a pending invite-era account is let in),
// 'suspended' blocks sign-in while keeping the person's history, 'rejected'
// turns down a pending request.
const SETTABLE_STATUSES = ['approved', 'suspended', 'rejected'];

async function changeStatus(actor, id, status) {
  if (!SETTABLE_STATUSES.includes(status)) {
    return { error: `Status must be one of: ${SETTABLE_STATUSES.join(', ')}`, status: 400 };
  }

  const target = await getStaffMember(id);
  const problem = await guardStaffChange(actor, target);
  if (problem) return problem;
  if (target.status === status) return { error: `They are already ${status}.`, status: 400 };

  const { data, error } = await supabase
    .from('users')
    .update({ status })
    .eq('id', id)
    .select(PROFILE_FIELDS)
    .single();

  if (error) throw error;
  return { staff: data, previousStatus: target.status };
}

// Removes the sign-in account as well as the profile. Their orders, payments
// and audit entries survive: those columns are "on delete set null", so the
// history stays readable with the name recorded on it at the time.
async function removeStaff(actor, id) {
  const target = await getStaffMember(id);
  const problem = await guardStaffChange(actor, target);
  if (problem) return problem;

  const { error } = await supabase.from('users').delete().eq('id', id);
  if (error) throw error;

  const { error: authErr } = await supabase.auth.admin.deleteUser(id);
  if (authErr) console.error('Removed staff profile but could not delete the auth user:', authErr.message);

  return { removed: target };
}

module.exports = {
  INVITE_TTL_DAYS,
  INVITABLE_ROLES,
  SETTABLE_STATUSES,
  hashToken,
  listStaff,
  listInvites,
  createInvite,
  revokeInvite,
  acceptInvite,
  getStaffMember,
  countSuperAdmins,
  changeRole,
  changeStatus,
  removeStaff,
};

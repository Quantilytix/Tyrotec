const asyncHandler = require('../utils/asyncHandler');
const staffService = require('../services/staffService');
const { logForUser } = require('../services/activityLogService');
const { notifyInternalTeam } = require('../services/notificationService');

const label = (user) => user.company_name || user.full_name || user.email;

// Admin and above: the full staff list, including pending and suspended.
const getStaff = asyncHandler(async (req, res) => {
  return res.json(await staffService.listStaff());
});

const getInvites = asyncHandler(async (req, res) => {
  return res.json(await staffService.listInvites());
});

// Admin and above may invite a sales rep or an admin; only a super admin may
// invite another super admin, so nobody can quietly mint their own equal.
const inviteStaff = asyncHandler(async (req, res) => {
  const { email, full_name, role } = req.body;

  if (role === 'super_admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Only a super admin can invite another super admin.' });
  }

  const result = await staffService.createInvite({
    email,
    fullName: full_name,
    role,
    invitedBy: req.user.id,
  });
  if (result.error) return res.status(result.status).json({ error: result.error });

  await logForUser(req.user, {
    action: 'staff.invited',
    entityType: 'staff_invite',
    entityId: result.invite.id,
    description: `${label(req.user)} invited ${result.invite.email} as ${role.replace('_', ' ')}.`,
  });

  // The link is returned so it can be copied and sent by hand -- email
  // delivery isn't a prerequisite for adding staff.
  return res.status(201).json(result);
});

const revokeInvite = asyncHandler(async (req, res) => {
  const result = await staffService.revokeInvite(req.params.id);
  if (result.error) return res.status(result.status).json({ error: result.error });

  await logForUser(req.user, {
    action: 'staff.invite_revoked',
    entityType: 'staff_invite',
    entityId: req.params.id,
    description: `${label(req.user)} cancelled the invitation for ${result.invite.email}.`,
  });

  return res.status(204).send();
});

// Public: the invitee sets their password using the token from their link.
const acceptInvite = asyncHandler(async (req, res) => {
  const { token, password, full_name } = req.body;

  const result = await staffService.acceptInvite({ token, password, fullName: full_name });
  if (result.error) return res.status(result.status).json({ error: result.error });

  // Logged as the new staff member's own first action, so the audit trail
  // shows who accepted and when, next to who invited them.
  await logForUser(result.profile, {
    action: 'staff.invite_accepted',
    entityType: 'user',
    entityId: result.profile.id,
    description: `${label(result.profile)} accepted a staff invitation and joined as ${result.profile.role.replace('_', ' ')}.`,
  });

  await notifyInternalTeam({
    type: 'general',
    title: 'Staff invitation accepted',
    message: `${label(result.profile)} (${result.profile.email}) accepted their invitation and now has ${result.profile.role.replace('_', ' ')} access.`,
    relatedType: 'user',
    relatedId: result.profile.id,
  });

  return res.status(201).json({ message: 'Your staff account is ready. You can sign in now.' });
});

// Super admin only.
const changeRole = asyncHandler(async (req, res) => {
  const result = await staffService.changeRole(req.user, req.params.id, req.body.role);
  if (result.error) return res.status(result.status).json({ error: result.error });

  await logForUser(req.user, {
    action: 'staff.role_changed',
    entityType: 'user',
    entityId: req.params.id,
    description: `${label(req.user)} changed ${label(result.staff)}'s role from ${result.previousRole.replace('_', ' ')} to ${result.staff.role.replace('_', ' ')}.`,
  });

  return res.json(result.staff);
});

// Super admin only: suspend, reactivate, or turn down a pending account.
const changeStatus = asyncHandler(async (req, res) => {
  const result = await staffService.changeStatus(req.user, req.params.id, req.body.status);
  if (result.error) return res.status(result.status).json({ error: result.error });

  await logForUser(req.user, {
    action: 'staff.status_changed',
    entityType: 'user',
    entityId: req.params.id,
    description: `${label(req.user)} changed ${label(result.staff)}'s account status from ${result.previousStatus} to ${result.staff.status}.`,
  });

  return res.json(result.staff);
});

// Super admin only.
const removeStaff = asyncHandler(async (req, res) => {
  const result = await staffService.removeStaff(req.user, req.params.id);
  if (result.error) return res.status(result.status).json({ error: result.error });

  await logForUser(req.user, {
    action: 'staff.removed',
    entityType: 'user',
    entityId: req.params.id,
    description: `${label(req.user)} removed the ${result.removed.role.replace('_', ' ')} account for ${result.removed.email}.`,
  });

  return res.status(204).send();
});

module.exports = {
  getStaff,
  getInvites,
  inviteStaff,
  revokeInvite,
  acceptInvite,
  changeRole,
  changeStatus,
  removeStaff,
};

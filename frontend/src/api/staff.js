import apiClient from './client';

// Staff accounts are invite-only: there is no public staff signup. Admins
// invite and see the list; only super admins can change a role, suspend an
// account or remove someone (enforced by the API, not just hidden here).

export const getStaff = () => apiClient.get('/staff');

export const getStaffInvites = () => apiClient.get('/staff/invites');

// Returns { invite, token, link } -- the link is shown once so it can be
// copied and sent, and can never be retrieved again.
export const inviteStaff = ({ email, full_name, role }) =>
  apiClient.post('/staff/invites', { email, full_name, role });

export const revokeStaffInvite = (id) => apiClient.delete(`/staff/invites/${id}`);

export const changeStaffRole = (id, role) => apiClient.patch(`/staff/${id}/role`, { role });

export const changeStaffStatus = (id, status) => apiClient.patch(`/staff/${id}/status`, { status });

export const removeStaff = (id) => apiClient.delete(`/staff/${id}`);

// Public: the invitee sets their password from the link they were sent.
export const acceptStaffInvite = ({ token, password, full_name }) =>
  apiClient.post('/auth/staff/accept-invite', { token, password, full_name });

// Legacy: accounts that requested staff access before invitations existed.
export const getPendingStaffAdmin = () => apiClient.get('/auth/staff/pending');

export const reviewStaffSignupAdmin = (id, status) =>
  apiClient.patch(`/auth/staff/${id}/status`, { status });

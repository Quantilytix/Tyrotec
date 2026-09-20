import apiClient from './client';

// The audit log, read as two views: `audience: 'staff'` (staff and automated
// actors) or `audience: 'customer'`. Admin and above only.
export const getActivityLog = ({ page = 1, limit = 50, audience, action, search, from, to } = {}) =>
  apiClient.get('/activity-log', { params: { page, limit, audience, action, search, from, to } });

// The action types actually present in the log, for the filter dropdown.
export const getActivityActions = () => apiClient.get('/activity-log/actions');

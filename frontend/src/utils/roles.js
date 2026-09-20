// Roles are ranked, mirroring backend/src/utils/roles.js.
//
// Screens ask "is this person at least an admin?" rather than listing every
// role that qualifies, so a super admin automatically sees everything an admin
// sees. The API enforces the same ranking -- this only decides what's shown.

export const ROLE_RANK = {
  customer: 0,
  sales_rep: 1,
  admin: 2,
  super_admin: 3,
};

export const STAFF_ROLES = ['sales_rep', 'admin', 'super_admin'];

export const ROLE_LABELS = {
  customer: 'Customer',
  sales_rep: 'Sales rep',
  admin: 'Admin',
  super_admin: 'Super admin',
};

export function roleLabel(role) {
  return ROLE_LABELS[role] || String(role || '').replace(/_/g, ' ');
}

export function rankOf(role) {
  return ROLE_RANK[role] ?? -1;
}

// True when `role` is at least as privileged as `minimum`. Customer is not a
// rank staff outrank: customer-only screens (the cart, my quotes) stay
// customer-only.
export function atLeast(role, minimum) {
  if (minimum === 'customer') return role === 'customer';
  return rankOf(role) >= rankOf(minimum) && rankOf(minimum) > 0;
}

export const isStaff = (role) => STAFF_ROLES.includes(role);
export const isAdmin = (role) => atLeast(role, 'admin');
export const isSuperAdmin = (role) => role === 'super_admin';

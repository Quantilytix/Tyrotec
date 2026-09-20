// Roles are ranked, not a flat list.
//
// Every permission check in the API is written as "an admin may do this", and
// a super admin must be able to do everything an admin can. Ranking them here
// means a new role above admin can never accidentally be locked out of a route
// someone forgot to update -- the alternative was editing 27 separate
// requireRole([...]) lists by hand and missing one.
//
// Anything genuinely reserved for super admins (changing roles, suspending or
// removing staff) is guarded explicitly with requireRole(['super_admin']).
const ROLE_RANK = {
  customer: 0,
  sales_rep: 1,
  admin: 2,
  super_admin: 3,
};

const STAFF_ROLES = ['sales_rep', 'admin', 'super_admin'];

function rankOf(role) {
  return ROLE_RANK[role] ?? -1;
}

// True when `role` is at least as privileged as one of `allowed`. Customer is
// deliberately not a rank anyone outranks: staff are not "super customers",
// and customer-only routes (converting your own quote to an order) must never
// be callable by an admin acting on someone else's behalf.
function satisfiesRole(role, allowed = []) {
  if (allowed.includes(role)) return true;
  if (allowed.includes('customer')) return false;
  return allowed.some((candidate) => rankOf(role) >= rankOf(candidate) && rankOf(candidate) > 0);
}

function isStaff(role) {
  return STAFF_ROLES.includes(role);
}

module.exports = { ROLE_RANK, STAFF_ROLES, rankOf, satisfiesRole, isStaff };

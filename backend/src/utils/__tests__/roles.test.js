const { satisfiesRole, isStaff, rankOf } = require('../roles');

describe('satisfiesRole', () => {
  it('admits the exact role named', () => {
    expect(satisfiesRole('admin', ['admin'])).toBe(true);
    expect(satisfiesRole('sales_rep', ['admin', 'sales_rep'])).toBe(true);
  });

  // The whole point of ranking: every existing requireRole(['admin']) and
  // requireRole(['admin','sales_rep']) route must admit a super admin without
  // being edited.
  it('admits a super admin anywhere an admin is allowed', () => {
    expect(satisfiesRole('super_admin', ['admin'])).toBe(true);
    expect(satisfiesRole('super_admin', ['admin', 'sales_rep'])).toBe(true);
    expect(satisfiesRole('super_admin', ['sales_rep'])).toBe(true);
  });

  it('does not let a lower role reach a higher one', () => {
    expect(satisfiesRole('sales_rep', ['admin'])).toBe(false);
    expect(satisfiesRole('customer', ['admin', 'sales_rep'])).toBe(false);
    expect(satisfiesRole('admin', ['super_admin'])).toBe(false);
    expect(satisfiesRole('sales_rep', ['super_admin'])).toBe(false);
  });

  // Customer-only routes are about whose data it is, not seniority: converting
  // your own quote to an order must not be callable by staff on someone's
  // behalf.
  it('never lets staff satisfy a customer-only route', () => {
    for (const role of ['sales_rep', 'admin', 'super_admin']) {
      expect(satisfiesRole(role, ['customer'])).toBe(false);
    }
    expect(satisfiesRole('customer', ['customer'])).toBe(true);
  });

  it('refuses unknown or missing roles', () => {
    expect(satisfiesRole(undefined, ['admin'])).toBe(false);
    expect(satisfiesRole('hacker', ['sales_rep'])).toBe(false);
    expect(satisfiesRole('admin', [])).toBe(false);
  });
});

describe('isStaff / rankOf', () => {
  it('counts the three staff roles, not customers', () => {
    expect(['sales_rep', 'admin', 'super_admin'].every(isStaff)).toBe(true);
    expect(isStaff('customer')).toBe(false);
    expect(isStaff(undefined)).toBe(false);
  });

  it('ranks roles in order of privilege', () => {
    expect(rankOf('super_admin')).toBeGreaterThan(rankOf('admin'));
    expect(rankOf('admin')).toBeGreaterThan(rankOf('sales_rep'));
    expect(rankOf('sales_rep')).toBeGreaterThan(rankOf('customer'));
    expect(rankOf('nonsense')).toBe(-1);
  });
});

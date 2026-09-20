const mockFrom = jest.fn();
const mockCreateUser = jest.fn();
const mockDeleteUser = jest.fn();
jest.mock('../../config/supabase', () => ({
  from: mockFrom,
  auth: { admin: { createUser: mockCreateUser, deleteUser: mockDeleteUser } },
}));

const staffService = require('../staffService');

// A chainable stand-in for the Supabase query builder. Each call to from()
// takes the next scripted result; terminal calls (single/maybeSingle, or
// awaiting the builder) resolve to it.
function scriptResults(results) {
  const queue = [...results];
  mockFrom.mockImplementation(() => {
    const result = queue.shift() ?? { data: null, error: null };
    const builder = {
      then: (resolve) => Promise.resolve(result).then(resolve),
      single: () => Promise.resolve(result),
      maybeSingle: () => Promise.resolve(result),
    };
    for (const method of ['select', 'insert', 'upsert', 'update', 'delete', 'eq', 'in', 'is', 'or', 'order', 'limit', 'range']) {
      builder[method] = () => builder;
    }
    return builder;
  });
}

const SUPER = { id: 'super-1', role: 'super_admin', email: 'boss@tyrotec.co.za', status: 'approved' };
const ADMIN = { id: 'admin-1', role: 'admin', email: 'admin@tyrotec.co.za', status: 'approved' };
const REP = { id: 'rep-1', role: 'sales_rep', email: 'rep@tyrotec.co.za', status: 'approved' };
const CUSTOMER = { id: 'cust-1', role: 'customer', email: 'buyer@example.com', status: 'approved' };

describe('changeRole', () => {
  beforeEach(() => mockFrom.mockReset());

  it('promotes a sales rep to admin', async () => {
    scriptResults([
      { data: REP, error: null }, // getStaffMember
      { data: { ...REP, role: 'admin' }, error: null }, // update (no super-admin count: the target isn't one)
    ]);

    const result = await staffService.changeRole(SUPER, REP.id, 'admin');
    expect(result.previousRole).toBe('sales_rep');
    expect(result.staff.role).toBe('admin');
  });

  // Locking yourself out is only fixable with direct database access.
  it('refuses to change your own role', async () => {
    scriptResults([{ data: SUPER, error: null }]);
    const result = await staffService.changeRole(SUPER, SUPER.id, 'admin');
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/your own/i);
  });

  // Demoting the only super admin would leave nobody able to manage roles.
  it('refuses to demote the last super admin', async () => {
    scriptResults([{ data: { ...SUPER, id: 'other-super' }, error: null }, { count: 1, error: null }]);
    const result = await staffService.changeRole(SUPER, 'other-super', 'admin');
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/last super admin/i);
  });

  it('allows demoting a super admin while another one remains', async () => {
    scriptResults([
      { data: { ...SUPER, id: 'other-super' }, error: null },
      { count: 2, error: null },
      { data: { ...SUPER, id: 'other-super', role: 'admin' }, error: null },
    ]);
    expect((await staffService.changeRole(SUPER, 'other-super', 'admin')).staff.role).toBe('admin');
  });

  it('rejects a role that is not a staff role', async () => {
    const result = await staffService.changeRole(SUPER, REP.id, 'customer');
    expect(result.status).toBe(400);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('refuses to touch a customer account through the staff endpoints', async () => {
    scriptResults([{ data: CUSTOMER, error: null }]);
    const result = await staffService.changeRole(SUPER, CUSTOMER.id, 'admin');
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/not a staff account/i);
  });

  it('404s for an account that does not exist', async () => {
    scriptResults([{ data: null, error: null }]);
    expect((await staffService.changeRole(SUPER, 'nobody', 'admin')).status).toBe(404);
  });
});

describe('changeStatus', () => {
  beforeEach(() => mockFrom.mockReset());

  it('suspends a staff member', async () => {
    scriptResults([
      { data: ADMIN, error: null },
      { data: { ...ADMIN, status: 'suspended' }, error: null },
    ]);
    const result = await staffService.changeStatus(SUPER, ADMIN.id, 'suspended');
    expect(result.previousStatus).toBe('approved');
    expect(result.staff.status).toBe('suspended');
  });

  it('refuses to suspend yourself', async () => {
    scriptResults([{ data: SUPER, error: null }]);
    expect((await staffService.changeStatus(SUPER, SUPER.id, 'suspended')).status).toBe(400);
  });

  it('rejects a status it does not recognise', async () => {
    const result = await staffService.changeStatus(SUPER, ADMIN.id, 'deleted');
    expect(result.status).toBe(400);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('acceptInvite', () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockCreateUser.mockReset();
  });

  const invite = {
    id: 'inv-1',
    email: 'new@tyrotec.co.za',
    role: 'sales_rep',
    expires_at: new Date(Date.now() + 60000).toISOString(),
    accepted_at: null,
    revoked_at: null,
  };

  it('rejects an unknown token without creating anything', async () => {
    scriptResults([{ data: null, error: null }]);
    const result = await staffService.acceptInvite({ token: 'made-up', password: 'password123' });
    expect(result.status).toBe(400);
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('rejects a token that was already used', async () => {
    scriptResults([{ data: { ...invite, accepted_at: new Date().toISOString() }, error: null }]);
    const result = await staffService.acceptInvite({ token: 't', password: 'password123' });
    expect(result.error).toMatch(/already been used/i);
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('rejects a cancelled invitation', async () => {
    scriptResults([{ data: { ...invite, revoked_at: new Date().toISOString() }, error: null }]);
    expect((await staffService.acceptInvite({ token: 't', password: 'password123' })).error).toMatch(/cancelled/i);
  });

  it('rejects an expired invitation', async () => {
    scriptResults([{ data: { ...invite, expires_at: new Date(Date.now() - 1000).toISOString() }, error: null }]);
    expect((await staffService.acceptInvite({ token: 't', password: 'password123' })).error).toMatch(/expired/i);
  });

  // The role comes from the invite the admin created, never from the request.
  it('creates the account with the role the invite carries', async () => {
    scriptResults([
      { data: invite, error: null },
      { data: { id: 'new-1', email: invite.email, role: 'sales_rep', status: 'approved' }, error: null },
      { data: null, error: null },
    ]);
    mockCreateUser.mockResolvedValue({ data: { user: { id: 'new-1' } }, error: null });

    const result = await staffService.acceptInvite({ token: 't', password: 'password123', fullName: 'New Person' });
    expect(result.profile.role).toBe('sales_rep');
    expect(mockCreateUser).toHaveBeenCalledWith(expect.objectContaining({ email: invite.email, email_confirm: true }));
  });
});

describe('hashToken', () => {
  it('stores a hash, never the token itself', () => {
    const hash = staffService.hashToken('secret-token');
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain('secret-token');
    expect(staffService.hashToken('secret-token')).toBe(hash);
    expect(staffService.hashToken('other-token')).not.toBe(hash);
  });
});

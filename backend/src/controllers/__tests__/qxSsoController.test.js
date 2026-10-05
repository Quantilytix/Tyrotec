const mockScoped = { auth: { verifyOtp: jest.fn() } };
jest.mock('../../config/supabase', () => ({
  from: jest.fn(),
  auth: { admin: { generateLink: jest.fn() } },
  createScopedClient: jest.fn(() => mockScoped),
}));
jest.mock('../../services/activityLogService', () => ({ logForUser: jest.fn(), logActivity: jest.fn() }));

const supabase = require('../../config/supabase');
const { logActivity, logForUser } = require('../../services/activityLogService');
const { qxSso, likeLiteral } = require('../qxSsoController');

function profileQuery(profile) {
  const q = {};
  q.select = jest.fn(() => q);
  q.ilike = jest.fn(() => q);
  q.maybeSingle = jest.fn(() => Promise.resolve({ data: profile, error: null }));
  return q;
}

// The account's QX link: read, then (when unlinked) written.
function linkQuery(linkedTo, writeError = null) {
  const q = {};
  q.select = jest.fn(() => q);
  q.eq = jest.fn(() => q);
  q.maybeSingle = jest.fn(() => Promise.resolve({ data: { qx_user_id: linkedTo }, error: null }));
  q.update = jest.fn(() => q);
  q.is = jest.fn(() => Promise.resolve({ error: writeError }));
  return q;
}

// supabase.from('users') is called for the profile, then for the link.
function usersTable(profile, link) {
  supabase.from.mockReturnValueOnce(profileQuery(profile));
  for (let i = 0; i < 2; i++) supabase.from.mockReturnValueOnce(link);
}

function run(code = 'a-valid-one-time-code-xyz') {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(body) { resolve({ status: this.statusCode, body }); return this; },
    };
    qxSso({ body: { code } }, res, (err) => resolve({ status: 500, err }));
  });
}

const STAFF = { id: 'u1', email: 'staff1@tyrotec.co.za', role: 'admin', status: 'approved', full_name: 'Staff One' };

describe('POST /api/auth/qx-sso', () => {
  const OLD_ENV = process.env;
  let fetchSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    supabase.from.mockReset(); // drop queued answers a refused sign-in didn't use
    process.env = { ...OLD_ENV, QX_CONNECT_URL: 'https://qx.example/api/connect/v1', QX_CONNECT_KEY: 'qx_live_k' };
    fetchSpy = jest.spyOn(global, 'fetch');
    supabase.auth.admin.generateLink.mockResolvedValue({ data: { properties: { hashed_token: 'th' } }, error: null });
    mockScoped.auth.verifyOtp.mockResolvedValue({ data: { session: { access_token: 'at', refresh_token: 'rt', expires_at: 9 } }, error: null });
  });
  afterEach(() => fetchSpy.mockRestore());
  afterAll(() => { process.env = OLD_ENV; });

  const qxSays = (status, body) => fetchSpy.mockResolvedValue({ status, json: async () => body });

  it('signs in an approved staff member QX vouched for', async () => {
    qxSays(200, { user: { qx_user_id: 'q1', email: 'Staff1@Tyrotec.co.za', name: 'Staff One' } });
    const q = profileQuery(STAFF);
    const link = linkQuery(null);
    supabase.from.mockReturnValueOnce(q).mockReturnValue(link);

    const { status, body } = await run();
    expect(status).toBe(200);
    expect(body).toEqual({ access_token: 'at', refresh_token: 'rt', expires_at: 9, user: STAFF });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://qx.example/api/connect/v1/sso/exchange');
    expect(init.headers['X-API-Key']).toBe('qx_live_k');
    expect(JSON.parse(init.body)).toEqual({ code: 'a-valid-one-time-code-xyz' });
    expect(q.ilike).toHaveBeenCalledWith('email', 'staff1@tyrotec.co.za');
    expect(supabase.auth.admin.generateLink).toHaveBeenCalledWith({ type: 'magiclink', email: STAFF.email });
    expect(mockScoped.auth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'th', type: 'magiclink' });
    expect(logForUser).toHaveBeenCalledWith(STAFF, expect.objectContaining({ action: 'auth.login_qx' }));
    // First sign-in from QX links the account to that QX user.
    expect(link.update).toHaveBeenCalledWith({ qx_user_id: 'q1' });
    expect(link.is).toHaveBeenCalledWith('qx_user_id', null);
  });

  it('signs in again as the QX user the account is linked to (no new link written)', async () => {
    qxSays(200, { user: { qx_user_id: 'q1', email: 'staff1@tyrotec.co.za' } });
    const link = linkQuery('q1');
    usersTable(STAFF, link);
    expect((await run()).status).toBe(200);
    expect(link.update).not.toHaveBeenCalled();
  });

  it('refuses a different QX user with the same email once the account is linked', async () => {
    qxSays(200, { user: { qx_user_id: 'q2-impostor', email: 'staff1@tyrotec.co.za' } });
    usersTable(STAFF, linkQuery('q1'));
    const { status, body } = await run();
    expect(status).toBe(403);
    expect(body.error).toMatch(/linked to a different QX user/);
    expect(supabase.auth.admin.generateLink).not.toHaveBeenCalled();
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.qx_sso_refused' }));
  });

  it('refuses when that QX user is already linked to another portal account', async () => {
    qxSays(200, { user: { qx_user_id: 'q1', email: 'staff1@tyrotec.co.za' } });
    usersTable(STAFF, linkQuery(null, { code: '23505', message: 'duplicate key' }));
    const { status, body } = await run();
    expect(status).toBe(403);
    expect(body.error).toMatch(/already linked to another portal account/);
    expect(supabase.auth.admin.generateLink).not.toHaveBeenCalled();
  });

  it('refuses an answer from QX with no QX user id', async () => {
    qxSays(200, { user: { email: 'staff1@tyrotec.co.za' } });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    usersTable(STAFF, linkQuery(null));
    expect((await run()).status).toBe(502);
    expect(supabase.auth.admin.generateLink).not.toHaveBeenCalled();
    console.error.mockRestore();
  });

  it.each([
    ['a customer account', { ...STAFF, role: 'customer' }, /no staff account/],
    ['no account at all', null, /no staff account/],
    ['a suspended staff account', { ...STAFF, status: 'suspended' }, /not active/],
  ])('refuses %s, logs it, and never creates a session', async (_, profile, message) => {
    qxSays(200, { user: { email: 'staff1@tyrotec.co.za' } });
    supabase.from.mockReturnValue(profileQuery(profile));
    const { status, body } = await run();
    expect(status).toBe(403);
    expect(body.error).toMatch(message);
    expect(supabase.auth.admin.generateLink).not.toHaveBeenCalled();
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.qx_sso_refused' }));
  });

  it.each([
    [401, 'invalid_code', 401, /expired or was already used/],
    [403, 'access_removed', 403, /no longer has access/],
  ])('QX %s %s -> %s', async (qxStatus, code, expected, message) => {
    qxSays(qxStatus, { error: 'x', code });
    const { status, body } = await run();
    expect(status).toBe(expected);
    expect(body.error).toMatch(message);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('QX unreachable -> 502, nothing else happens', async () => {
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const { status } = await run();
    expect(status).toBe(502);
    expect(supabase.from).not.toHaveBeenCalled();
    console.error.mockRestore();
  });

  it('sign-in works with sending data switched off (QX_SYNC_ENABLED unset)', async () => {
    delete process.env.QX_SYNC_ENABLED;
    qxSays(200, { user: { qx_user_id: 'q1', email: 'staff1@tyrotec.co.za' } });
    usersTable(STAFF, linkQuery('q1'));
    expect((await run()).status).toBe(200);
  });

  it('not configured -> 503', async () => {
    delete process.env.QX_CONNECT_URL;
    expect((await run()).status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('matches the email literally (no LIKE wildcards)', () => {
    expect(likeLiteral('a_b%c\\d@x.co')).toBe('a\\_b\\%c\\\\d@x.co');
  });
});

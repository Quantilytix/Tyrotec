jest.mock('../../config/supabase', () => ({
  from: jest.fn(),
  auth: { admin: { createUser: jest.fn() } },
}));
jest.mock('../../services/notificationService', () => ({
  notifyUser: jest.fn(),
  notifyInternalTeam: jest.fn(),
  sendEmail: jest.fn(),
}));
jest.mock('../../services/whatsappConversationService', () => ({
  normalizePhone: jest.fn((p) => p),
  findUserByPhone: jest.fn(() => Promise.resolve(null)),
}));
jest.mock('../../services/activityLogService', () => ({ logActivity: jest.fn(), logForUser: jest.fn() }));

const supabase = require('../../config/supabase');
const { register } = require('../authController');

function profileUpsert(profile) {
  const q = {};
  q.upsert = jest.fn(() => q);
  q.select = jest.fn(() => q);
  q.single = jest.fn(() => Promise.resolve({ data: profile, error: null }));
  return q;
}

function run(body) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b }); return this; },
    };
    register({ body }, res, (err) => resolve({ status: 500, err }));
  });
}

const SIGNUP = { email: 'buyer@example.com', password: 'longenough', company_name: 'Buyer Co' };

describe('POST /api/auth/register', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    supabase.from.mockReset();
  });

  it('creates a customer when the email is free', async () => {
    supabase.auth.admin.createUser.mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null });
    supabase.from.mockReturnValue(profileUpsert({ id: 'u-1', email: SIGNUP.email }));

    const { status, body } = await run(SIGNUP);

    expect(status).toBe(201);
    expect(body.user).toMatchObject({ id: 'u-1' });
  });

  // Staff create customers by hand for people who order by email. Those
  // accounts are real and confirmed but have a random password, so the one
  // thing that works is a password reset -- the old message said only "already
  // registered", which left them with nowhere to go.
  it('points an existing email at password recovery instead of a dead end', async () => {
    supabase.auth.admin.createUser.mockResolvedValue({
      data: null,
      error: { status: 422, message: 'A user with this email address has already been registered' },
    });

    const { status, body } = await run(SIGNUP);

    expect(status).toBe(400);
    expect(body.error).toMatch(/already has an account/i);
    expect(body.error).toMatch(/forgot password/i);
    // The flag is what makes the frontend render a link rather than plain text.
    expect(body.recoverable).toBe(true);
  });

  it('recognises the collision by message even without a 422 status', async () => {
    supabase.auth.admin.createUser.mockResolvedValue({
      data: null,
      error: { message: 'A user with this email address has already been registered' },
    });

    const { body } = await run(SIGNUP);

    expect(body.recoverable).toBe(true);
  });

  // Anything else is a real failure and must not be dressed up as recoverable,
  // or the frontend sends people to reset a password that was never the issue.
  it('does not mark an unrelated failure as recoverable', async () => {
    supabase.auth.admin.createUser.mockResolvedValue({
      data: null,
      error: { status: 400, message: 'Password should be at least 6 characters' },
    });

    const { status, body } = await run(SIGNUP);

    expect(status).toBe(400);
    expect(body.error).toMatch(/Password should be/);
    expect(body.recoverable).toBeUndefined();
  });

  it('still refuses to create staff through the public door', async () => {
    const { status, body } = await run({ ...SIGNUP, role: 'admin' });

    expect(status).toBe(400);
    expect(body.error).toMatch(/invitation only/i);
    expect(supabase.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it('still requires a VAT number from a VAT-registered business', async () => {
    const { status, body } = await run({ ...SIGNUP, is_vat_registered: true });

    expect(status).toBe(400);
    expect(body.error).toMatch(/VAT number is required/i);
  });
});

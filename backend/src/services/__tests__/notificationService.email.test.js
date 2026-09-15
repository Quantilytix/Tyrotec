jest.mock('../../config/supabase', () => ({}));
jest.mock('../../config/whatsapp', () => ({ sendText: jest.fn() }));

const mockSendMail = jest.fn();
jest.mock('nodemailer', () => ({ createTransport: jest.fn(() => ({ sendMail: mockSendMail })) }));

const EMAIL_ENV = ['BREVO_API_KEY', 'EMAIL_FROM', 'SMTP_FROM', 'SMTP_USER', 'SMTP_HOST'];

describe('sendEmail', () => {
  let sendEmail;
  const savedEnv = {};

  beforeEach(() => {
    jest.resetModules();
    mockSendMail.mockReset();
    global.fetch = jest.fn();
    for (const key of EMAIL_ENV) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    ({ sendEmail } = require('../notificationService'));
  });

  afterEach(() => {
    for (const key of EMAIL_ENV) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    delete global.fetch;
  });

  it('sends through Brevo when BREVO_API_KEY is set, with a named sender', async () => {
    process.env.BREVO_API_KEY = 'xkeysib-test';
    process.env.EMAIL_FROM = 'Tyrotec <sales@tyrotec.co.za>';
    process.env.SMTP_HOST = 'smtp.gmail.com';
    global.fetch.mockResolvedValue({ ok: true });

    await sendEmail('buyer@example.com', 'Order approved', 'Your order #12 was approved.');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(options.headers['api-key']).toBe('xkeysib-test');
    expect(JSON.parse(options.body)).toEqual({
      sender: { name: 'Tyrotec', email: 'sales@tyrotec.co.za' },
      to: [{ email: 'buyer@example.com' }],
      subject: 'Order approved',
      textContent: 'Your order #12 was approved.',
    });
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('accepts a bare sender address and falls back to SMTP_FROM', async () => {
    process.env.BREVO_API_KEY = 'xkeysib-test';
    process.env.SMTP_FROM = 'sales@tyrotec.co.za';
    global.fetch.mockResolvedValue({ ok: true });

    await sendEmail('buyer@example.com', 'Hi', 'Body');

    expect(JSON.parse(global.fetch.mock.calls[0][1].body).sender).toEqual({ email: 'sales@tyrotec.co.za' });
  });

  it('logs a Brevo rejection instead of throwing', async () => {
    process.env.BREVO_API_KEY = 'xkeysib-bad';
    process.env.EMAIL_FROM = 'sales@tyrotec.co.za';
    global.fetch.mockResolvedValue({ ok: false, status: 401, text: async () => '{"message":"Key not found"}' });
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(sendEmail('buyer@example.com', 'Hi', 'Body')).resolves.toBeUndefined();
    expect(consoleError.mock.calls[0].join(' ')).toContain('Brevo responded 401');
    consoleError.mockRestore();
  });

  it('uses SMTP when no Brevo key is set', async () => {
    process.env.SMTP_HOST = 'smtp.gmail.com';
    process.env.EMAIL_FROM = 'Tyrotec <sales@tyrotec.co.za>';
    mockSendMail.mockResolvedValue({});

    await sendEmail('buyer@example.com', 'Hi', 'Body');

    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockSendMail).toHaveBeenCalledWith({ from: 'Tyrotec <sales@tyrotec.co.za>', to: 'buyer@example.com', subject: 'Hi', text: 'Body' });
  });

  it('does nothing when no email provider is configured or there is no recipient', async () => {
    await sendEmail('buyer@example.com', 'Hi', 'Body');
    process.env.BREVO_API_KEY = 'xkeysib-test';
    await sendEmail(null, 'Hi', 'Body');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});

const crypto = require('crypto');

const SECRET = 'sk_test_unit_only';

describe('paystackService', () => {
  let paystack;
  const realFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    process.env.PAYSTACK_SECRET_KEY = SECRET;
    process.env.FRONTEND_URL = 'https://portal.example';
    paystack = require('../paystackService');
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  describe('verifyWebhookSignature', () => {
    const body = Buffer.from('{"event":"charge.success","data":{"reference":"TYR-1-ab"}}');
    const sign = (buf, key = SECRET) => crypto.createHmac('sha512', key).update(buf).digest('hex');

    it('accepts the HMAC-SHA512 of the exact raw body', () => {
      expect(paystack.verifyWebhookSignature(body, sign(body))).toBe(true);
    });

    it('rejects a body changed after signing', () => {
      const tampered = Buffer.from(body.toString().replace('TYR-1-ab', 'TYR-2-ab'));
      expect(paystack.verifyWebhookSignature(tampered, sign(body))).toBe(false);
    });

    it('rejects a signature made with another key, a missing one, or garbage', () => {
      expect(paystack.verifyWebhookSignature(body, sign(body, 'sk_test_other'))).toBe(false);
      expect(paystack.verifyWebhookSignature(body, undefined)).toBe(false);
      expect(paystack.verifyWebhookSignature(body, 'abc')).toBe(false);
    });

    it('rejects everything when no secret key is configured', () => {
      const signature = sign(body);
      delete process.env.PAYSTACK_SECRET_KEY;
      expect(paystack.verifyWebhookSignature(body, signature)).toBe(false);
    });
  });

  it('sends amounts in cents without floating-point drift', () => {
    expect(paystack.toCents('1150.00')).toBe(115000);
    expect(paystack.toCents(19.99)).toBe(1999);
    expect(paystack.toCents(0.1 + 0.2)).toBe(30);
  });

  it('makes a new reference per attempt, in characters Paystack allows', () => {
    const a = paystack.newReference({ order_number: 57 });
    const b = paystack.newReference({ order_number: 57 });
    expect(a).toMatch(/^TYR-57-[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
  });

  it('reads metadata whether Paystack returns an object or a JSON string', () => {
    expect(paystack.metadataOf({ metadata: { order_id: 'o1' } }).order_id).toBe('o1');
    expect(paystack.metadataOf({ metadata: '{"order_id":"o2"}' }).order_id).toBe('o2');
    expect(paystack.metadataOf({ metadata: 'not json' })).toEqual({});
    expect(paystack.metadataOf({})).toEqual({});
  });

  describe('initializeTransaction', () => {
    it('asks Paystack for a ZAR payment in cents, returning to the order page', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: true, data: { authorization_url: 'https://checkout.paystack.com/x', reference: 'TYR-9-aa' } }),
      });

      const result = await paystack.initializeTransaction(
        { id: 'order-1', order_number: 9, invoice_number: 3, total_amount: '1150.00' },
        'buyer@example.com'
      );

      expect(result).toEqual({ authorizationUrl: 'https://checkout.paystack.com/x', reference: 'TYR-9-aa' });
      const [url, init] = global.fetch.mock.calls[0];
      expect(url).toBe('https://api.paystack.co/transaction/initialize');
      expect(init.headers.Authorization).toBe(`Bearer ${SECRET}`);
      const sent = JSON.parse(init.body);
      expect(sent).toMatchObject({
        email: 'buyer@example.com',
        amount: 115000,
        currency: 'ZAR',
        callback_url: 'https://portal.example/orders/order-1',
        metadata: { order_id: 'order-1', cancel_action: 'https://portal.example/orders/order-1' },
      });
    });

    it("turns Paystack's refusal into a PaystackError with its message", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ status: false, message: 'Invalid key' }),
      });
      await expect(
        paystack.initializeTransaction({ id: 'o', order_number: 1, total_amount: 1 }, 'a@b.c')
      ).rejects.toThrow(new paystack.PaystackError('Invalid key'));
    });

    it('refuses to call Paystack without a secret key', async () => {
      delete process.env.PAYSTACK_SECRET_KEY;
      global.fetch = jest.fn();
      await expect(
        paystack.initializeTransaction({ id: 'o', order_number: 1, total_amount: 1 }, 'a@b.c')
      ).rejects.toBeInstanceOf(paystack.PaystackError);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});

describe('payfastService', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      PAYFAST_MERCHANT_ID: '10000100',
      PAYFAST_MERCHANT_KEY: '46f0cd694581a',
      PAYFAST_PASSPHRASE: 'test-passphrase',
      // Sandbox signs with its own passphrase, never the live account's --
      // see credentials() in payfastService.js.
      PAYFAST_SANDBOX_PASSPHRASE: 'test-passphrase',
      PAYFAST_RETURN_URL: 'https://example.com/return',
      PAYFAST_CANCEL_URL: 'https://example.com/cancel',
      BACKEND_URL: 'https://api.example.com',
      PAYFAST_MODE: 'sandbox',
    };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  // The sandbox is a separate PayFast system with its own merchant accounts.
  // Posting live credentials to it fails with "merchant id not found", which
  // is what happens when PAYFAST_MODE=sandbox is set and the live values are
  // simply left in place.
  describe('credentials per mode', () => {
    it('bills the same merchant in sandbox mode', () => {
      process.env.PAYFAST_MERCHANT_ID = '10053760';
      process.env.PAYFAST_MERCHANT_KEY = 'live-key';
      const { buildCheckoutFields } = require('../payfastService');

      const { fields } = buildCheckoutFields(
        { id: 'order-1', order_number: 42, total_amount: 100 },
        { email: 'a@b.com' }
      );

      expect(fields.merchant_id).toBe('10053760');
      expect(fields.merchant_key).toBe('live-key');
    });

    it('prefers explicit sandbox credentials when they are configured', () => {
      process.env.PAYFAST_SANDBOX_MERCHANT_ID = '10099999';
      process.env.PAYFAST_SANDBOX_MERCHANT_KEY = 'my-sandbox-key';
      const { buildCheckoutFields } = require('../payfastService');

      const { fields } = buildCheckoutFields(
        { id: 'order-1', order_number: 42, total_amount: 100 },
        { email: 'a@b.com' }
      );

      expect(fields.merchant_id).toBe('10099999');
      expect(fields.merchant_key).toBe('my-sandbox-key');
    });

    it('signs with the live passphrase in live mode', () => {
      process.env.PAYFAST_MODE = 'live';
      process.env.PAYFAST_PASSPHRASE = 'live-passphrase';
      const { credentials } = require('../payfastService');

      expect(credentials().passphrase).toBe('live-passphrase');
    });

    it('uses the live merchant in live mode', () => {
      process.env.PAYFAST_MODE = 'live';
      process.env.PAYFAST_MERCHANT_ID = '10053760';
      process.env.PAYFAST_MERCHANT_KEY = 'live-key';
      const { buildCheckoutFields } = require('../payfastService');

      const { fields } = buildCheckoutFields(
        { id: 'order-1', order_number: 42, total_amount: 100 },
        { email: 'a@b.com' }
      );

      expect(fields.merchant_id).toBe('10053760');
      expect(fields.merchant_key).toBe('live-key');
    });

    // The live passphrase belongs to the live account. Reusing it against a
    // sandbox account that has none produces "Generated signature does not
    // match submitted signature" -- confirmed against the real sandbox.
    it('does not sign sandbox checkouts with the live passphrase', () => {
      delete process.env.PAYFAST_SANDBOX_PASSPHRASE;
      process.env.PAYFAST_PASSPHRASE = 'live-passphrase';
      const { credentials } = require('../payfastService');

      expect(credentials().passphrase).toBeUndefined();
    });
  });

  describe('isSandbox / checkoutUrl (via buildCheckoutFields)', () => {
    it('uses the sandbox checkout URL when PAYFAST_MODE is unset or sandbox', () => {
      delete process.env.PAYFAST_MODE;
      const { buildCheckoutFields } = require('../payfastService');
      const { action } = buildCheckoutFields(
        { id: 'order-1', order_number: 42, total_amount: 100 },
        { email: 'a@b.com' }
      );
      expect(action).toBe('https://sandbox.payfast.co.za/eng/process');
    });

    it('uses the live checkout URL when PAYFAST_MODE=live', () => {
      process.env.PAYFAST_MODE = 'live';
      const { buildCheckoutFields } = require('../payfastService');
      const { action } = buildCheckoutFields(
        { id: 'order-1', order_number: 42, total_amount: 100 },
        { email: 'a@b.com' }
      );
      expect(action).toBe('https://www.payfast.co.za/eng/process');
    });
  });

  describe('buildCheckoutFields', () => {
    it('builds the expected field set and includes a signature', () => {
      const { buildCheckoutFields } = require('../payfastService');
      const order = { id: 'order-123', order_number: 42, total_amount: 199.995 };
      const customer = { email: 'customer@example.com', company_name: 'Acme Co' };

      const { fields } = buildCheckoutFields(order, customer);

      expect(fields.merchant_id).toBe('10000100');
      expect(fields.merchant_key).toBe('46f0cd694581a');
      expect(fields.m_payment_id).toBe('order-123');
      expect(fields.amount).toBe('200.00'); // rounds/formats to 2dp
      expect(fields.name_first).toBe('Acme Co');
      expect(fields.email_address).toBe('customer@example.com');
      expect(fields.item_name).toBe('Order #42');
      expect(fields.notify_url).toBe('https://api.example.com/api/payments/payfast/notify');
      expect(typeof fields.signature).toBe('string');
      expect(fields.signature).toHaveLength(32); // md5 hex digest
    });

    it('falls back to email for name_first when the customer has no company_name', () => {
      const { buildCheckoutFields } = require('../payfastService');
      const { fields } = buildCheckoutFields(
        { id: 'order-1', order_number: 1, total_amount: 50 },
        { email: 'solo@example.com' }
      );
      expect(fields.name_first).toBe('solo@example.com');
    });
  });

  describe('verifyItnSignature', () => {
    it('accepts a signature computed the same way buildCheckoutFields computes it', () => {
      const { buildCheckoutFields, verifyItnSignature } = require('../payfastService');
      const { fields } = buildCheckoutFields(
        { id: 'order-1', order_number: 1, total_amount: 50 },
        { email: 'a@b.com' }
      );
      // The ITN payload PayFast posts back has the same field/signature shape.
      expect(verifyItnSignature(fields)).toBe(true);
    });

    it('validates a real captured PayFast ITN payload with blank fields (regression: PayFast signs blanks on this direction, unlike the outbound checkout signature which must skip them)', () => {
      process.env.PAYFAST_PASSPHRASE = '';
      delete process.env.PAYFAST_SANDBOX_PASSPHRASE;
      const { verifyItnSignature } = require('../payfastService');
      // Captured live from a real PayFast sandbox ITN callback -- this exact
      // payload was silently rejected before computeSignature() learned to
      // treat the ITN direction differently from the checkout direction.
      const realItnPayload = {
        m_payment_id: '9ea73809-884e-46e1-8c53-ad15b1268cd3',
        pf_payment_id: '3363096',
        payment_status: 'COMPLETE',
        item_name: 'Order #45',
        item_description: '',
        amount_gross: '10300.00',
        amount_fee: '-236.90',
        amount_net: '10063.10',
        custom_str1: '',
        custom_str2: '',
        custom_str3: '',
        custom_str4: '',
        custom_str5: '',
        custom_int1: '',
        custom_int2: '',
        custom_int3: '',
        custom_int4: '',
        custom_int5: '',
        name_first: 'QweQwe',
        name_last: '',
        email_address: 'leeroygit7@gmail.com',
        merchant_id: '10053760',
        signature: '84be2167856ec0f1860925c082f395db',
      };
      expect(verifyItnSignature(realItnPayload)).toBe(true);
    });

    it('rejects a payload whose signature does not match its fields', () => {
      const { verifyItnSignature } = require('../payfastService');
      const tampered = {
        merchant_id: '10000100',
        amount_gross: '999.00', // tampered after signing
        signature: 'deadbeefdeadbeefdeadbeefdeadbeef',
      };
      expect(verifyItnSignature(tampered)).toBe(false);
    });

    it('rejects a payload with no signature field at all', () => {
      const { verifyItnSignature } = require('../payfastService');
      expect(verifyItnSignature({ merchant_id: '10000100' })).toBe(false);
    });

    it('rejects a signature of the wrong length without throwing', () => {
      const { verifyItnSignature } = require('../payfastService');
      expect(verifyItnSignature({ merchant_id: '10000100', signature: 'short' })).toBe(false);
    });

    it('is sensitive to field order (PayFast signs "order given", not sorted)', () => {
      const crypto = require('crypto');
      const { verifyItnSignature } = require('../payfastService');

      const inOrderFields = { merchant_id: '1', amount: '10.00' };
      const reorderedFields = { amount: '10.00', merchant_id: '1' };

      const sign = (obj) => {
        const pairs = Object.entries(obj).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
        pairs.push(`passphrase=${encodeURIComponent('test-passphrase')}`);
        return crypto.createHash('md5').update(pairs.join('&')).digest('hex');
      };

      const signedInOrder = { ...inOrderFields, signature: sign(inOrderFields) };
      // Verifying the *reordered* fields against a signature computed for the
      // original order should fail, since payfastEncode/computeSignature
      // walks Object.entries() in insertion order, not sorted.
      const reorderedWithSameSignature = { ...reorderedFields, signature: signedInOrder.signature };

      expect(verifyItnSignature(signedInOrder)).toBe(true);
      expect(verifyItnSignature(reorderedWithSameSignature)).toBe(false);
    });
  });

  describe('revalidateWithPayfast', () => {
    const originalFetch = global.fetch;
    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('returns true only when PayFast responds with exactly "VALID"', async () => {
      global.fetch = jest.fn().mockResolvedValue({ text: () => Promise.resolve('VALID') });
      const { revalidateWithPayfast } = require('../payfastService');
      await expect(revalidateWithPayfast('raw=body')).resolves.toBe(true);
    });

    it('returns false for any other response body', async () => {
      global.fetch = jest.fn().mockResolvedValue({ text: () => Promise.resolve('INVALID') });
      const { revalidateWithPayfast } = require('../payfastService');
      await expect(revalidateWithPayfast('raw=body')).resolves.toBe(false);
    });

    it('returns false (not a throw) when the request itself fails', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
      const { revalidateWithPayfast } = require('../payfastService');
      await expect(revalidateWithPayfast('raw=body')).resolves.toBe(false);
    });
  });
});

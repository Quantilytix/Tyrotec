// Paystack: the customer's way to pay online (card, EFT and whatever else is
// switched on in Tyrotec's Paystack dashboard).
//
// Everything here runs on the server with the SECRET key. The portal never
// sees a Paystack key: it asks this API for a payment link, sends the
// customer there, and Paystack sends them back to the order page.
//
// Nothing the browser says is trusted. A payment counts only once this server
// has asked Paystack itself (verifyTransaction) -- whether it heard about it
// from the signed webhook or from the customer landing back on the portal.

const crypto = require('crypto');
const { invoiceLabel } = require('../utils/invoiceNumber');

const API = 'https://api.paystack.co';
const TIMEOUT_MS = 15000;
// Tyrotec's Paystack account pays out in rand (FNB). Amounts go to Paystack
// in cents.
const CURRENCY = 'ZAR';

function secretKey() {
  return process.env.PAYSTACK_SECRET_KEY || '';
}

function isTestMode() {
  return secretKey().startsWith('sk_test_');
}

function toCents(amount) {
  return Math.round(Number(amount) * 100);
}

class PaystackError extends Error {}

async function callPaystack(path, { method = 'GET', body } = {}) {
  if (!secretKey()) throw new PaystackError('Online payments are not set up yet (PAYSTACK_SECRET_KEY is missing).');

  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${secretKey()}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new PaystackError(`Could not reach Paystack: ${err.message}`);
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status !== true) {
    throw new PaystackError(json.message || `Paystack answered ${res.status}.`);
  }
  return json.data;
}

// Unique per attempt: Paystack refuses a reference it has seen before, and a
// customer may open Pay now more than once for the same order.
function newReference(order) {
  return `TYR-${order.order_number}-${crypto.randomBytes(4).toString('hex')}`;
}

function saleName(order) {
  return order.invoice_number ? `Invoice ${invoiceLabel(order.invoice_number)}` : `Order #${order.order_number}`;
}

// order (with total_amount, order_number, invoice_number) + the customer's
// email -> the Paystack page to send the customer to. Paystack returns them
// to the order page either way: callback_url after paying, cancel_action if
// they back out.
async function initializeTransaction(order, email) {
  const orderPage = `${process.env.FRONTEND_URL || ''}/orders/${order.id}`;
  const data = await callPaystack('/transaction/initialize', {
    method: 'POST',
    body: {
      email,
      amount: toCents(order.total_amount),
      currency: CURRENCY,
      reference: newReference(order),
      callback_url: orderPage,
      metadata: {
        order_id: order.id,
        cancel_action: orderPage,
        custom_fields: [{ display_name: 'For', variable_name: 'sale', value: saleName(order) }],
      },
    },
  });
  return { authorizationUrl: data.authorization_url, reference: data.reference };
}

// The transaction as Paystack has it -- the only version of it we trust.
async function verifyTransaction(reference) {
  return callPaystack(`/transaction/verify/${encodeURIComponent(reference)}`);
}

// Paystack signs every webhook: HMAC-SHA512 of the exact raw body, keyed with
// the secret key, in the x-paystack-signature header.
function verifyWebhookSignature(rawBody, signature) {
  if (!rawBody || !signature || !secretKey()) return false;
  const expected = crypto.createHmac('sha512', secretKey()).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(String(signature)), Buffer.from(expected));
  } catch {
    return false; // different length: not equal
  }
}

// Paystack hands metadata back as an object, or as the JSON string it was
// stored as on some older paths.
function metadataOf(tx) {
  const meta = tx?.metadata;
  if (!meta) return {};
  if (typeof meta === 'string') {
    try {
      return JSON.parse(meta) || {};
    } catch {
      return {};
    }
  }
  return meta;
}

module.exports = {
  CURRENCY,
  PaystackError,
  isTestMode,
  toCents,
  newReference,
  initializeTransaction,
  verifyTransaction,
  verifyWebhookSignature,
  metadataOf,
};

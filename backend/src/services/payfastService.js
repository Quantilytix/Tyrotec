// PayFast integration: builds the signed checkout fields the frontend posts
// the browser to, and verifies/re-validates an incoming ITN (Instant
// Transaction Notification) webhook. Per PayFast's ITN documentation, the
// browser's return_url redirect is NEVER trusted for state changes -- only
// this server-to-server notify path is, after both the signature check and
// the mandatory re-validation call below succeed.
//
// Verified end-to-end against a real PayFast sandbox transaction. That
// exercise caught a real bug (see computeSignature's skipEmpty comment
// below) that no amount of reading PayFast's docs surfaced -- ITN
// signatures include PayFast's blank custom_str/custom_int/etc. fields,
// which the outbound checkout signature must instead omit.

const crypto = require('crypto');

function isSandbox() {
  return (process.env.PAYFAST_MODE || 'sandbox') !== 'live';
}

function checkoutUrl() {
  return isSandbox() ? 'https://sandbox.payfast.co.za/eng/process' : 'https://www.payfast.co.za/eng/process';
}

function validateUrl() {
  return isSandbox()
    ? 'https://sandbox.payfast.co.za/eng/query/validate'
    : 'https://www.payfast.co.za/eng/query/validate';
}

// PayFast's signature: URL-encode each value the way PayFast expects
// (spaces as '+', via encodeURIComponent + a small fixup, matching their
// PHP-originated examples), concatenate as key=value&key=value in the exact
// field order given, append the passphrase, MD5 hash the result. The field
// order matters -- it's not a sorted/canonical order, it's "the order you
// built the object in", so callers must pass fields in the order PayFast's
// docs specify.
function payfastEncode(value) {
  return encodeURIComponent(String(value).trim()).replace(/%20/g, '+');
}

// skipEmpty matters and differs by direction, confirmed against a real ITN
// payload: when *generating* a signature for the checkout request, PayFast's
// docs say to exclude blank variables -- but when they send an ITN back,
// they sign every field they post, including the blank custom_str1-5/
// custom_int1-5/item_description/name_last fields PayFast always includes.
// Sharing one filter behavior between both directions silently broke ITN
// signature verification for every single transaction (checkoutFields never
// has a genuinely blank value in practice, so skipEmpty:true is a no-op
// there either way -- this only ever mattered for the ITN direction).
function computeSignature(fields, passphrase, { skipEmpty } = { skipEmpty: true }) {
  let entries = Object.entries(fields);
  if (skipEmpty) {
    entries = entries.filter(([, value]) => value !== undefined && value !== null && value !== '');
  }
  const pairs = entries.map(([key, value]) => `${key}=${payfastEncode(value)}`);

  if (passphrase) {
    pairs.push(`passphrase=${payfastEncode(passphrase)}`);
  }

  return crypto.createHash('md5').update(pairs.join('&')).digest('hex');
}

// Which merchant to bill, and with which passphrase, for the mode we're in.
//
// The merchant account is the same in both modes -- a PayFast sandbox
// account is registered against the same merchant ID -- so only the
// passphrase differs, and that difference is the whole reason this function
// exists.
//
// A signature is only valid if it was salted with the passphrase configured
// on *that* PayFast account. The sandbox account here has none set, so
// signing sandbox checkouts with the live passphrase produced "Generated
// signature does not match submitted signature" and the payment page never
// loaded. Verified directly against sandbox.payfast.co.za: same merchant,
// with the passphrase 400s, without it the payment page renders.
//
// Set PAYFAST_SANDBOX_PASSPHRASE only if a passphrase is later configured on
// the sandbox account itself.
function credentials() {
  const merchant = {
    merchant_id: process.env.PAYFAST_MERCHANT_ID,
    merchant_key: process.env.PAYFAST_MERCHANT_KEY,
  };
  if (!isSandbox()) {
    return { ...merchant, passphrase: process.env.PAYFAST_PASSPHRASE };
  }
  return {
    merchant_id: process.env.PAYFAST_SANDBOX_MERCHANT_ID || merchant.merchant_id,
    merchant_key: process.env.PAYFAST_SANDBOX_MERCHANT_KEY || merchant.merchant_key,
    passphrase: process.env.PAYFAST_SANDBOX_PASSPHRASE || undefined,
  };
}

// order/customer -> the signed field set + the URL to auto-post the browser
// to. Field order follows PayFast's own documented example order.
function buildCheckoutFields(order, customer) {
  const { merchant_id, merchant_key, passphrase } = credentials();
  const fields = {
    merchant_id,
    merchant_key,
    return_url: process.env.PAYFAST_RETURN_URL,
    cancel_url: process.env.PAYFAST_CANCEL_URL,
    notify_url: `${process.env.BACKEND_URL || ''}/api/payments/payfast/notify`,
    name_first: customer.company_name || customer.email,
    email_address: customer.email,
    m_payment_id: order.id,
    amount: Number(order.total_amount).toFixed(2),
    item_name: `Order #${order.order_number}`,
  };

  const signature = computeSignature(fields, passphrase);

  return { action: checkoutUrl(), fields: { ...fields, signature } };
}

// rawFields: the posted ITN body as a plain object (field order preserved --
// see payfastWebhookController.js for how it's parsed). Compares against the
// posted `signature` field, which is excluded from the recomputation.
function verifyItnSignature(rawFields) {
  const { signature, ...rest } = rawFields;
  if (!signature) return false;

  // Verified with the same passphrase the checkout was signed with.
  const expected = computeSignature(rest, credentials().passphrase, { skipEmpty: false });

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false; // length mismatch -- definitely not equal
  }
}

// The required server-to-server re-validation: PayFast expects the exact
// raw posted body echoed back to their validate endpoint, and only a
// response body of exactly "VALID" is trusted.
async function revalidateWithPayfast(rawBody) {
  try {
    const res = await fetch(validateUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: rawBody,
    });
    const text = (await res.text()).trim();
    return text === 'VALID';
  } catch (err) {
    console.error('PayFast re-validation request failed:', err.message);
    return false;
  }
}

module.exports = { buildCheckoutFields, verifyItnSignature, revalidateWithPayfast, isSandbox, credentials };

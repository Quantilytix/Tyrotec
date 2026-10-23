// Product discounts (038_discounts.sql). Creating and ending one runs in a
// database function so a discount and its products change together.

const supabase = require('../config/supabase');
const { saToday, isDiscountActive } = require('../utils/discounts');

const STAFF_READABLE = [
  /^Enter the reason/, /^The discount must be/, /^The last day can't be in the past$/, /^Pick at least one product$/,
  /^One or more products were not found$/, /^Already on discount: /, /^Discount not found$/, /^This discount has already ended$/,
];

function friendlyDiscountError(error) {
  const message = String(error?.message || '');
  return STAFF_READABLE.some((re) => re.test(message)) ? message : 'Something went wrong. Please try again.';
}

function validateDiscountInput(body = {}) {
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const percent = Number(body.percent);
  const endsOn = body.ends_on ? String(body.ends_on) : null;
  const productIds = Array.isArray(body.product_ids) ? [...new Set(body.product_ids.map(String))] : [];

  if (!reason) return { error: 'Enter the reason for the discount. Customers see it.' };
  if (reason.length > 200) return { error: 'Keep the reason under 200 characters.' };
  if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) {
    return { error: 'The discount must be more than 0% and less than 100%.' };
  }
  if (endsOn && !/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) return { error: 'Enter the last day as a date.' };
  if (endsOn && endsOn < saToday()) return { error: "The last day can't be in the past." };
  if (productIds.length === 0) return { error: 'Pick at least one product.' };
  return { value: { reason, percent: Math.round(percent * 100) / 100, ends_on: endsOn, product_ids: productIds } };
}

async function createDiscount(value, userId) {
  const { data, error } = await supabase.rpc('create_discount', {
    p_reason: value.reason,
    p_percent: value.percent,
    p_ends_on: value.ends_on,
    p_product_ids: value.product_ids,
    p_created_by: userId,
  });
  if (error) return { error: friendlyDiscountError(error), status: 400 };
  return { id: data };
}

async function endDiscount(discountId) {
  const { error } = await supabase.rpc('end_discount', { p_discount_id: discountId });
  if (error) return { error: friendlyDiscountError(error), status: 400 };
  return { id: discountId };
}

// Every discount, newest first, with whether it's still active and the
// products it covers.
async function listDiscounts() {
  const { data, error } = await supabase
    .from('discounts')
    .select('*, created_by_user:users!discounts_created_by_fkey(full_name, email), discount_products(product:products(id, sku, name, unit_price))')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const today = saToday();
  return (data || []).map((d) => ({
    ...d,
    active: isDiscountActive(d, today),
    products: (d.discount_products || []).map((dp) => dp.product).filter(Boolean),
    discount_products: undefined,
  }));
}

async function clearExpiredDiscounts() {
  const { error } = await supabase.rpc('clear_expired_discounts');
  if (error) throw error;
}

// The lines of a quote whose discount has since ended or passed its last
// day. A quote with any can't be accepted: its prices no longer apply.
async function endedDiscountLines(quoteItems) {
  const discounted = (quoteItems || []).filter((item) => item.discount_id);
  if (discounted.length === 0) return [];
  const { data, error } = await supabase
    .from('discounts')
    .select('id, ended_at, ends_on')
    .in('id', [...new Set(discounted.map((item) => item.discount_id))]);
  if (error) throw error;
  const today = saToday();
  const activeIds = new Set((data || []).filter((d) => isDiscountActive(d, today)).map((d) => d.id));
  return discounted.filter((item) => !activeIds.has(item.discount_id));
}

// Refuses to turn a quote into an order once a discount it was priced with
// has ended. Returns an error result, or null when the quote can go ahead.
async function checkQuoteDiscounts(quoteId) {
  const { data: items, error } = await supabase
    .from('quote_items')
    .select('discount_id, products(name)')
    .eq('quote_id', quoteId);
  if (error) throw error;
  const ended = await endedDiscountLines(items);
  if (ended.length === 0) return null;
  const names = ended.map((item) => item.products?.name).filter(Boolean).join(', ');
  return {
    error: `The discount on ${names || 'this quote'} has ended, so this quote's prices no longer apply. Get an updated quote to order.`,
    status: 409,
    code: 'discount_ended',
  };
}

module.exports = {
  validateDiscountInput,
  createDiscount,
  endDiscount,
  listDiscounts,
  clearExpiredDiscounts,
  endedDiscountLines,
  checkQuoteDiscounts,
  friendlyDiscountError,
};

const supabase = require('../config/supabase');
const { notifyInternalTeam } = require('./notificationService');
const { formatCurrency } = require('../utils/formatCurrency');
const { documentTotals, rateForProduct } = require('../utils/vat');
const { pricedLine, saToday, discountedPrice } = require('../utils/discounts');
const { checkQuoteDiscounts } = require('./discountService');

const STAFF_DISCOUNT_REASON = 'Staff discount';

// A staff discount on one quote line (staff quotes only): a percentage off the
// product's normal price, with an optional reason the customer sees. Not a
// catalogue discount: it belongs to this quote alone, and is never "ended".
function staffLineDiscount(item) {
  const blank = item.discount_percent === undefined || item.discount_percent === null || item.discount_percent === '';
  if (blank) return { discount: null };
  const percent = Number(item.discount_percent);
  if (!Number.isFinite(percent) || percent < 0 || percent >= 100) {
    return { error: 'A discount must be from 0% to less than 100%.' };
  }
  if (percent === 0) return { discount: null };
  const reason = String(item.discount_reason || '').trim() || STAFF_DISCOUNT_REASON;
  if (reason.length > 200) return { error: 'Keep the discount reason under 200 characters.' };
  return { discount: { percent: Math.round(percent * 100) / 100, reason } };
}

// Prices a quote's lines from the catalogue, now: shared by creating a quote
// and editing one, so both are priced exactly the same way. The same product
// listed twice becomes one line with the quantities added together.
//
// options.staff: the request comes from staff, so a line may carry its own
//   discount_percent / discount_reason (staffLineDiscount). Customers' lines
//   never can.
// options.keep: Map product_id -> { percent, reason }, staff discounts to keep
//   when a customer edits a quote staff discounted.
// Returns { quoteItemsData, totals } or { error, status }.
async function priceQuoteItems(items, { staff = false, keep = null } = {}) {
  if (!items || items.length === 0) {
    return { error: 'Quote items are required', status: 400 };
  }
  const merged = new Map();
  const discounts = new Map();
  for (const item of items) {
    merged.set(item.product_id, (merged.get(item.product_id) || 0) + Number(item.quantity));
    if (staff && !discounts.has(item.product_id)) {
      const { discount, error } = staffLineDiscount(item);
      if (error) return { error, status: 400 };
      if (discount) discounts.set(item.product_id, discount);
    }
  }
  if (!staff && keep) {
    for (const [productId, discount] of keep) if (merged.has(productId)) discounts.set(productId, discount);
  }

  const productIds = [...merged.keys()];
  const { data: products, error: pErr } = await supabase
    .from('products')
    .select('id, unit_price, vat_applicable, discount_id, discount_percent, discount_reason, discount_ends_on')
    .in('id', productIds);

  if (pErr) throw pErr;
  if (products.length !== productIds.length) {
    return { error: 'One or more products were not found', status: 400 };
  }

  const productMap = new Map(products.map((p) => [p.id, p]));

  // Prices are excl VAT, and the rate comes from the product, never from the
  // request -- a client can't talk the server out of charging VAT. The rate is
  // stored on the line so the document always states what it actually charged.
  // Likewise a discount: the product's current one, if any, priced here
  // (038), with the original price and reason kept on the line.
  const today = saToday();
  const quoteItemsData = productIds.map((productId) => {
    const product = productMap.get(productId);
    const staffDiscount = discounts.get(productId);
    // A staff discount is taken off the normal price and replaces any
    // catalogue discount on the line.
    const price = staffDiscount
      ? {
          unit_price: discountedPrice(product.unit_price, staffDiscount.percent),
          list_price: Number(product.unit_price),
          discount_id: null,
          discount_percent: staffDiscount.percent,
          discount_reason: staffDiscount.reason,
        }
      : pricedLine(product, today);
    return {
      product_id: productId,
      quantity: merged.get(productId),
      ...price,
      vat_rate: rateForProduct(product),
    };
  });

  return { quoteItemsData, totals: documentTotals(quoteItemsData) };
}

// Core logic behind creating a quote, shared by the portal's POST /quotes
// route and the WhatsApp quoteBuilding flow -- two front doors onto the same
// pipeline, not two implementations of it. `source` records which one was
// used (defaults to 'portal' so nothing changes for existing callers).
async function createQuoteForCustomer(customerId, customerLabel, items, source = 'portal', { staff = false } = {}) {
  const priced = await priceQuoteItems(items, { staff });
  if (priced.error) return priced;
  const { quoteItemsData } = priced;
  const { subtotal_amount, vat_amount, total_amount } = priced.totals;

  const { data: quote, error: qErr } = await supabase
    .from('quotes')
    .insert([
      { customer_id: customerId, subtotal_amount, vat_amount, total_amount, status: 'submitted', source },
    ])
    .select()
    .single();

  if (qErr) throw qErr;

  const itemsToInsert = quoteItemsData.map((item) => ({
    ...item,
    quote_id: quote.id,
  }));

  const { error: qiErr } = await supabase.from('quote_items').insert(itemsToInsert);
  if (qiErr) throw qiErr;

  await notifyInternalTeam({
    type: 'quote_submitted',
    title: 'New quote submitted',
    message: `${customerLabel} submitted quote #${quote.quote_number} for ${formatCurrency(total_amount)} via ${source}.`,
    relatedType: 'quote',
    relatedId: quote.id,
  });

  return { quoteId: quote.id, quoteNumber: quote.quote_number, total_amount, lines: quoteItemsData };
}

// Core logic behind converting a quote to an order, shared the same way.
async function convertQuoteForCustomer(customerId, customerLabel, quoteId, source = 'portal') {
  const { data: quote, error: qErr } = await supabase
    .from('quotes')
    .select('*, quote_items(*)')
    .eq('id', quoteId)
    .eq('customer_id', customerId)
    .single();

  if (qErr || !quote) return { error: 'Quote not found.', status: 404 };
  if (quote.status === 'converted') return { error: 'Quote already converted', status: 400 };
  if (quote.status === 'expired') return { error: 'Quote has expired', status: 400 };
  const discountProblem = await checkQuoteDiscounts(quote.id);
  if (discountProblem) return discountProblem;

  // Carries the quote's own figures across rather than recalculating: an
  // order must charge what the customer was quoted, even if a product's price
  // or VAT setting has changed since. Legacy quotes have null subtotal/VAT,
  // and the order inherits that, staying VAT-inclusive like its quote.
  const { data: order, error: oErr } = await supabase
    .from('orders')
    .insert([
      {
        quote_id: quote.id,
        customer_id: customerId,
        subtotal_amount: quote.subtotal_amount,
        vat_amount: quote.vat_amount,
        total_amount: quote.total_amount,
        source,
      },
    ])
    .select()
    .single();

  if (oErr) throw oErr;

  const orderItems = quote.quote_items.map((qi) => ({
    order_id: order.id,
    product_id: qi.product_id,
    quantity: qi.quantity,
    unit_price: qi.unit_price,
    vat_rate: qi.vat_rate,
  }));

  const { error: oiErr } = await supabase.from('order_items').insert(orderItems);
  if (oiErr) throw oiErr;

  await supabase.from('quotes').update({ status: 'converted' }).eq('id', quote.id);

  await notifyInternalTeam({
    type: 'quote_converted',
    title: 'Quote converted to order',
    message: `${customerLabel} converted quote #${quote.quote_number} into an order via ${source}, awaiting approval.`,
    relatedType: 'order',
    relatedId: order.id,
  });

  // order_number is the human-facing reference; callers log and display it.
  return { orderId: order.id, orderNumber: order.order_number, quoteNumber: quote.quote_number };
}

// Replaces a quote's products and quantities, priced again at today's prices
// (040_editable_quotes.sql). Only before the quote is ordered. Returns
// { quote: { id, quote_number, customer_id, before, after } } or { error, status }.
async function updateQuoteItems(quoteId, items, { staff = false } = {}) {
  const { data: quote, error: qErr } = await supabase
    .from('quotes')
    .select('id, quote_number, status, customer_id, total_amount')
    .eq('id', quoteId)
    .single();
  if (qErr || !quote) return { error: 'Quote not found.', status: 404 };
  if (!['draft', 'submitted'].includes(quote.status)) {
    return { error: 'This quote has already been ordered or has expired, so it can no longer be edited.', status: 400 };
  }

  // A customer's edit keeps the discounts staff gave on the lines still there.
  let keep = null;
  if (!staff) {
    const { data: current } = await supabase
      .from('quote_items')
      .select('product_id, discount_id, discount_percent, discount_reason')
      .eq('quote_id', quoteId);
    keep = new Map((current || [])
      .filter((l) => !l.discount_id && l.discount_percent)
      .map((l) => [l.product_id, { percent: Number(l.discount_percent), reason: l.discount_reason || STAFF_DISCOUNT_REASON }]));
  }

  const priced = await priceQuoteItems(items, { staff, keep });
  if (priced.error) return priced;
  const { subtotal_amount, vat_amount, total_amount } = priced.totals;

  const { error } = await supabase.rpc('replace_quote_items', {
    p_quote_id: quoteId,
    p_items: priced.quoteItemsData,
    p_subtotal: subtotal_amount,
    p_vat: vat_amount,
    p_total: total_amount,
  });
  if (error) {
    // The checks in the database function, worded for people.
    if (/can be edited|needs at least one product/.test(error.message)) return { error: error.message, status: 400 };
    throw error;
  }
  return {
    quote: {
      id: quote.id,
      quote_number: quote.quote_number,
      customer_id: quote.customer_id,
      before: Number(quote.total_amount),
      after: total_amount,
      lines: priced.quoteItemsData.length,
      items: priced.quoteItemsData,
    },
  };
}

module.exports = { createQuoteForCustomer, convertQuoteForCustomer, updateQuoteItems, priceQuoteItems, staffLineDiscount };

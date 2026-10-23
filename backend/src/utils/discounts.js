// Discount rules (038_discounts.sql), kept pure so pricing can be tested.

const TIMEZONE = 'Africa/Johannesburg';

// Today in South Africa, 'YYYY-MM-DD': a discount's last day is a local date.
function saToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

// A discount (or a product's copy of one) applies when it hasn't been ended
// and its last day, if any, isn't before today.
function isDiscountActive({ ended_at: endedAt = null, ends_on: endsOn = null } = {}, today = saToday()) {
  return !endedAt && (!endsOn || endsOn >= today);
}

// The product's current discount, or null.
function productDiscount(product, today = saToday()) {
  if (!product?.discount_id || !product.discount_percent) return null;
  if (!isDiscountActive({ ends_on: product.discount_ends_on }, today)) return null;
  return {
    id: product.discount_id,
    percent: Number(product.discount_percent),
    reason: product.discount_reason,
    ends_on: product.discount_ends_on,
  };
}

// Price after `percent` off, to the cent.
function discountedPrice(unitPrice, percent) {
  return Math.round(Number(unitPrice) * (100 - Number(percent))) / 100;
}

// A quote line priced from a product: the discounted price, plus what the
// line keeps to show the saving. No discount: just the product's price.
function pricedLine(product, today = saToday()) {
  const discount = productDiscount(product, today);
  if (!discount) {
    return { unit_price: product.unit_price, list_price: null, discount_id: null, discount_percent: null, discount_reason: null };
  }
  return {
    unit_price: discountedPrice(product.unit_price, discount.percent),
    list_price: Number(product.unit_price),
    discount_id: discount.id,
    discount_percent: discount.percent,
    discount_reason: discount.reason,
  };
}

// "15% off: End-of-year clearance"
function discountLabel(percent, reason) {
  const pct = Number(percent);
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}% off${reason ? `: ${reason}` : ''}`;
}

module.exports = { saToday, isDiscountActive, productDiscount, discountedPrice, pricedLine, discountLabel };

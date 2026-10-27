// Discounts (backend/sql/038_discounts.sql). The server works out every
// price; these only word what it decided.

// "15% off: End-of-year clearance"
export function discountLabel(percent, reason) {
  const pct = Number(percent);
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}% off${reason ? `: ${reason}` : ''}`;
}

// Price after a staff line discount, to the cent; the same rounding as the
// server (backend utils/discounts.js discountedPrice).
export function staffDiscountedPrice(price, percent) {
  const pct = Number(percent);
  if (!pct || pct <= 0 || pct >= 100) return Number(price);
  return Math.round(Number(price) * (100 - pct)) / 100;
}

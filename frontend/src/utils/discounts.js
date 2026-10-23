// Discounts (backend/sql/038_discounts.sql). The server works out every
// price; these only word what it decided.

// "15% off: End-of-year clearance"
export function discountLabel(percent, reason) {
  const pct = Number(percent);
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}% off${reason ? `: ${reason}` : ''}`;
}

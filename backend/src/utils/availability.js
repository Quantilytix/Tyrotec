// What to tell a customer about a product that can't all be supplied from
// stock right now, or null when it can. Out-of-stock products can still be
// quoted and ordered: the order waits until the stock arrives
// (037_orders_waiting_for_stock.sql).
//
// Mirrors frontend/src/utils/availability.js so WhatsApp and the portal say
// the same thing.

// Used when a product has no lead time set (0, from before it was
// required): the same default product imports use.
const DEFAULT_LEAD_TIME_DAYS = 7;

// A product's usual delivery time in days, never 0.
function leadTimeDays(value) {
  const days = Number(value) || 0;
  return days > 0 ? days : DEFAULT_LEAD_TIME_DAYS;
}

function availabilityNote(stockQuantity, quantity, leadTime) {
  const stock = Math.max(Number(stockQuantity) || 0, 0);
  const wanted = Math.max(Number(quantity) || 1, 1);
  if (wanted <= stock) return null;

  const days = leadTimeDays(leadTime);
  const usual = `about ${days} ${days === 1 ? 'day' : 'days'}`;
  return stock === 0
    ? `Out of stock: usually delivered in ${usual}.`
    : `Only ${stock} in stock: the rest usually take ${usual}.`;
}

module.exports = { availabilityNote, leadTimeDays, DEFAULT_LEAD_TIME_DAYS };

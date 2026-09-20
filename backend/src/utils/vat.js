// VAT arithmetic for quotes and orders.
//
// Prices are stored and quoted EXCLUDING VAT (023_vat_exclusive_pricing.sql).
// Each line records the rate actually charged on it -- 15 for standard-rated
// goods, 0 for a product marked as not VAT-applicable -- and a document's
// totals are the sum of its lines.
//
// Legacy documents (written before that migration) have vat_rate null and no
// stored subtotal/VAT: their prices already included VAT. isLegacyTotals below
// is how callers tell the two apart, so a customer's existing quote or receipt
// keeps printing exactly what it always did.

// South African standard rate. A line stores the rate it charged, so changing
// this only affects new documents.
const VAT_RATE = 15;

// Money is rounded per line, then summed -- the same order the printed
// document adds up in, so the PDF total always equals its own column.
function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

// One line's net (excl VAT), its VAT, and the gross the customer pays.
function lineTotals({ unit_price, quantity, vat_rate }) {
  const net = roundMoney((Number(unit_price) || 0) * (Number(quantity) || 0));
  const rate = Number(vat_rate) || 0;
  const vat = roundMoney((net * rate) / 100);
  return { net, vat, gross: roundMoney(net + vat) };
}

// Totals for a whole quote or order.
function documentTotals(items = []) {
  return items.reduce(
    (totals, item) => {
      const line = lineTotals(item);
      return {
        subtotal_amount: roundMoney(totals.subtotal_amount + line.net),
        vat_amount: roundMoney(totals.vat_amount + line.vat),
        total_amount: roundMoney(totals.total_amount + line.gross),
      };
    },
    { subtotal_amount: 0, vat_amount: 0, total_amount: 0 }
  );
}

// The rate to charge a line for a given product. VAT is always on unless the
// product itself is marked as not VAT-applicable (zero-rated/exempt goods) --
// it is never decided by who the customer is: Tyrotec is a registered vendor,
// so standard-rated goods carry VAT whether or not the buyer can claim it back.
function rateForProduct(product) {
  return product?.vat_applicable === false ? 0 : VAT_RATE;
}

// A document written before VAT-exclusive pricing: its total already included
// VAT and it has no stored breakdown.
function isLegacyTotals(document) {
  return document?.vat_amount === null || document?.vat_amount === undefined;
}

// What a legacy document's figures were, worked back out of the VAT-inclusive
// total the way the old receipt did -- used only for displaying old documents.
function legacyBreakdown(totalAmount) {
  const total = roundMoney(totalAmount);
  const vat = roundMoney((total * VAT_RATE) / (100 + VAT_RATE));
  return { subtotal_amount: roundMoney(total - vat), vat_amount: vat, total_amount: total };
}

// The figures to display for any document, old or new.
function displayTotals(document) {
  if (!isLegacyTotals(document)) {
    return {
      subtotal_amount: roundMoney(document.subtotal_amount),
      vat_amount: roundMoney(document.vat_amount),
      total_amount: roundMoney(document.total_amount),
      legacy: false,
    };
  }
  return { ...legacyBreakdown(document?.total_amount), legacy: true };
}

module.exports = {
  VAT_RATE,
  roundMoney,
  lineTotals,
  documentTotals,
  rateForProduct,
  isLegacyTotals,
  legacyBreakdown,
  displayTotals,
};

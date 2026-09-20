// VAT arithmetic for the portal, mirroring backend/src/utils/vat.js.
//
// Prices are quoted EXCLUDING VAT and VAT is added per line at the rate stored
// on that line (15 for standard-rated goods, 0 for products marked as not
// VAT-applicable). The server is what decides the rate and what a document
// actually costs -- these functions are for showing the customer the same
// arithmetic before the quote is saved, and for drawing the PDFs.
//
// Documents created before VAT-exclusive pricing have no stored breakdown:
// their prices already included VAT, and they must keep printing exactly as
// they did, so displayTotals works their figures back out instead.

export const VAT_RATE = 15;

export function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function lineTotals({ unit_price, quantity, vat_rate }) {
  const net = roundMoney((Number(unit_price) || 0) * (Number(quantity) || 0));
  const rate = Number(vat_rate) || 0;
  const vat = roundMoney((net * rate) / 100);
  return { net, vat, gross: roundMoney(net + vat) };
}

export function documentTotals(items = []) {
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

// The rate for a cart line or a draft quote line, taken from the product.
// Never from the customer: Tyrotec is a registered vendor, so standard-rated
// goods carry VAT whether or not the buyer is VAT-registered.
export function rateForProduct(product) {
  return product?.vat_applicable === false ? 0 : VAT_RATE;
}

export function isLegacyTotals(document) {
  return document?.vat_amount === null || document?.vat_amount === undefined;
}

export function displayTotals(document) {
  if (!isLegacyTotals(document)) {
    return {
      subtotal_amount: roundMoney(document.subtotal_amount),
      vat_amount: roundMoney(document.vat_amount),
      total_amount: roundMoney(document.total_amount),
      legacy: false,
    };
  }

  const total = roundMoney(document?.total_amount);
  const vat = roundMoney((total * VAT_RATE) / (100 + VAT_RATE));
  return { subtotal_amount: roundMoney(total - vat), vat_amount: vat, total_amount: total, legacy: true };
}

// How a line's VAT reads in a table: "15%", or a dash for a zero-rated line.
// A legacy line (null rate) says so rather than claiming 0%.
export function vatRateLabel(vat_rate) {
  if (vat_rate === null || vat_rate === undefined) return 'incl.';
  return Number(vat_rate) > 0 ? `${Number(vat_rate)}%` : '—';
}

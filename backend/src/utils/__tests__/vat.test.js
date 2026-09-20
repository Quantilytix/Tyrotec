const {
  VAT_RATE,
  lineTotals,
  documentTotals,
  rateForProduct,
  isLegacyTotals,
  legacyBreakdown,
  displayTotals,
} = require('../vat');

describe('lineTotals', () => {
  it('adds VAT on top of the excl-VAT price', () => {
    expect(lineTotals({ unit_price: 100, quantity: 2, vat_rate: 15 })).toEqual({
      net: 200,
      vat: 30,
      gross: 230,
    });
  });

  it('charges nothing extra on a zero-rated line', () => {
    expect(lineTotals({ unit_price: 100, quantity: 2, vat_rate: 0 })).toEqual({
      net: 200,
      vat: 0,
      gross: 200,
    });
  });

  it('rounds to cents so a printed line always adds up', () => {
    // 3 x 33.33 = 99.99 net, VAT 14.9985 -> 15.00
    expect(lineTotals({ unit_price: 33.33, quantity: 3, vat_rate: 15 })).toEqual({
      net: 99.99,
      vat: 15,
      gross: 114.99,
    });
  });

  it('treats a missing rate as no VAT rather than NaN', () => {
    expect(lineTotals({ unit_price: 100, quantity: 1 })).toEqual({ net: 100, vat: 0, gross: 100 });
  });
});

describe('documentTotals', () => {
  it('sums the lines into subtotal, VAT and total', () => {
    const totals = documentTotals([
      { unit_price: 100, quantity: 2, vat_rate: 15 },
      { unit_price: 50, quantity: 1, vat_rate: 15 },
    ]);
    expect(totals).toEqual({ subtotal_amount: 250, vat_amount: 37.5, total_amount: 287.5 });
  });

  it('mixes standard-rated and zero-rated lines in one document', () => {
    const totals = documentTotals([
      { unit_price: 100, quantity: 1, vat_rate: 15 },
      { unit_price: 100, quantity: 1, vat_rate: 0 },
    ]);
    expect(totals).toEqual({ subtotal_amount: 200, vat_amount: 15, total_amount: 215 });
  });

  it('always balances: subtotal + VAT equals the total', () => {
    const items = [
      { unit_price: 33.33, quantity: 3, vat_rate: 15 },
      { unit_price: 19.99, quantity: 7, vat_rate: 15 },
      { unit_price: 5.05, quantity: 11, vat_rate: 0 },
    ];
    const { subtotal_amount, vat_amount, total_amount } = documentTotals(items);
    expect(Math.round((subtotal_amount + vat_amount) * 100) / 100).toBe(total_amount);
  });

  it('is zero for an empty document', () => {
    expect(documentTotals([])).toEqual({ subtotal_amount: 0, vat_amount: 0, total_amount: 0 });
  });
});

describe('rateForProduct', () => {
  it('charges the standard rate by default', () => {
    expect(rateForProduct({ vat_applicable: true })).toBe(VAT_RATE);
    expect(rateForProduct({})).toBe(VAT_RATE);
  });

  it('charges nothing only when the product is marked as not VAT-applicable', () => {
    expect(rateForProduct({ vat_applicable: false })).toBe(0);
  });
});

describe('legacy documents', () => {
  it('recognises a document written before VAT-exclusive pricing', () => {
    expect(isLegacyTotals({ total_amount: 115, vat_amount: null })).toBe(true);
    expect(isLegacyTotals({ total_amount: 115 })).toBe(true);
    expect(isLegacyTotals({ total_amount: 115, vat_amount: 15 })).toBe(false);
  });

  // Old prices included VAT, so the breakdown is worked backwards -- exactly
  // what the receipt did before, so old documents keep printing the same.
  it('works the VAT back out of an inclusive total', () => {
    expect(legacyBreakdown(115)).toEqual({ subtotal_amount: 100, vat_amount: 15, total_amount: 115 });
  });

  it('displays new documents from their stored figures', () => {
    expect(displayTotals({ subtotal_amount: 200, vat_amount: 30, total_amount: 230 })).toEqual({
      subtotal_amount: 200,
      vat_amount: 30,
      total_amount: 230,
      legacy: false,
    });
  });

  it('displays legacy documents from their inclusive total, flagged as legacy', () => {
    expect(displayTotals({ total_amount: 115 })).toEqual({
      subtotal_amount: 100,
      vat_amount: 15,
      total_amount: 115,
      legacy: true,
    });
  });
});

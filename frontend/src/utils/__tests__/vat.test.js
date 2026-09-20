import { describe, it, expect } from 'vitest';
import {
  VAT_RATE,
  lineTotals,
  documentTotals,
  rateForProduct,
  isLegacyTotals,
  displayTotals,
  vatRateLabel,
} from '../vat';

// Mirrors backend/src/utils/__tests__/vat.test.js: the figures the customer
// sees while building a quote must match what the server then charges.

describe('lineTotals', () => {
  it('adds VAT on top of the excl-VAT price', () => {
    expect(lineTotals({ unit_price: 100, quantity: 2, vat_rate: 15 })).toEqual({ net: 200, vat: 30, gross: 230 });
  });

  it('charges nothing extra on a zero-rated line', () => {
    expect(lineTotals({ unit_price: 100, quantity: 2, vat_rate: 0 })).toEqual({ net: 200, vat: 0, gross: 200 });
  });

  it('rounds to cents so a printed line always adds up', () => {
    expect(lineTotals({ unit_price: 33.33, quantity: 3, vat_rate: 15 })).toEqual({
      net: 99.99,
      vat: 15,
      gross: 114.99,
    });
  });
});

describe('documentTotals', () => {
  it('sums mixed standard-rated and zero-rated lines', () => {
    expect(
      documentTotals([
        { unit_price: 100, quantity: 1, vat_rate: 15 },
        { unit_price: 100, quantity: 1, vat_rate: 0 },
      ])
    ).toEqual({ subtotal_amount: 200, vat_amount: 15, total_amount: 215 });
  });

  it('always balances: subtotal + VAT equals the total', () => {
    const { subtotal_amount, vat_amount, total_amount } = documentTotals([
      { unit_price: 19.99, quantity: 7, vat_rate: 15 },
      { unit_price: 5.05, quantity: 11, vat_rate: 0 },
    ]);
    expect(Math.round((subtotal_amount + vat_amount) * 100) / 100).toBe(total_amount);
  });

  it('is zero for an empty cart', () => {
    expect(documentTotals([])).toEqual({ subtotal_amount: 0, vat_amount: 0, total_amount: 0 });
  });
});

describe('rateForProduct', () => {
  // VAT is never decided by who the customer is -- only by the product.
  it('charges the standard rate unless the product says otherwise', () => {
    expect(rateForProduct({ vat_applicable: true })).toBe(VAT_RATE);
    expect(rateForProduct({})).toBe(VAT_RATE);
    expect(rateForProduct({ vat_applicable: false })).toBe(0);
  });
});

describe('displayTotals', () => {
  it('uses the stored figures on a new document', () => {
    expect(displayTotals({ subtotal_amount: 200, vat_amount: 30, total_amount: 230 })).toEqual({
      subtotal_amount: 200,
      vat_amount: 30,
      total_amount: 230,
      legacy: false,
    });
  });

  it('works a legacy VAT-inclusive total back out, and flags it', () => {
    expect(displayTotals({ total_amount: 115 })).toEqual({
      subtotal_amount: 100,
      vat_amount: 15,
      total_amount: 115,
      legacy: true,
    });
    expect(isLegacyTotals({ total_amount: 115, vat_amount: null })).toBe(true);
  });
});

describe('vatRateLabel', () => {
  it('reads as a percentage, a dash, or "incl." for a legacy line', () => {
    expect(vatRateLabel(15)).toBe('15%');
    expect(vatRateLabel(0)).toBe('—');
    expect(vatRateLabel(null)).toBe('incl.');
    expect(vatRateLabel(undefined)).toBe('incl.');
  });
});

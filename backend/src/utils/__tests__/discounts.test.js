const {
  saToday, isDiscountActive, productDiscount, discountedPrice, pricedLine, discountLabel,
} = require('../discounts');

describe('discounts', () => {
  it('reads today as the South African date', () => {
    // 23:30 UTC on 31 Oct is already 1 Nov in South Africa.
    expect(saToday(new Date('2026-10-31T23:30:00Z'))).toBe('2026-11-01');
  });

  it('treats a discount as active through its last day, and not once ended', () => {
    expect(isDiscountActive({ ends_on: '2026-11-01' }, '2026-11-01')).toBe(true);
    expect(isDiscountActive({ ends_on: '2026-10-31' }, '2026-11-01')).toBe(false);
    expect(isDiscountActive({ ends_on: null }, '2026-11-01')).toBe(true);
    expect(isDiscountActive({ ended_at: '2026-10-20T10:00:00Z' }, '2026-11-01')).toBe(false);
  });

  it('rounds the discounted price to the cent', () => {
    expect(discountedPrice(1500, 15)).toBe(1275);
    expect(discountedPrice('99.99', 12.5)).toBe(87.49);
  });

  it('prices a line from a discounted product, keeping the original price and reason', () => {
    const product = { unit_price: '1500', discount_id: 'd1', discount_percent: '15', discount_reason: 'Clearance', discount_ends_on: '2026-11-30' };
    expect(pricedLine(product, '2026-11-01')).toEqual({
      unit_price: 1275, list_price: 1500, discount_id: 'd1', discount_percent: 15, discount_reason: 'Clearance',
    });
  });

  it('prices at full price once the last day has passed, even before it is cleared', () => {
    const product = { unit_price: 1500, discount_id: 'd1', discount_percent: 15, discount_ends_on: '2026-10-31' };
    expect(productDiscount(product, '2026-11-01')).toBeNull();
    expect(pricedLine(product, '2026-11-01').unit_price).toBe(1500);
  });

  it('labels a discount for documents', () => {
    expect(discountLabel(15, 'Clearance')).toBe('15% off: Clearance');
    expect(discountLabel('12.50', null)).toBe('12.50% off');
  });
});

const { availabilityNote, leadTimeDays } = require('../availability');

describe('availabilityNote', () => {
  it('says nothing when stock covers the quantity', () => {
    expect(availabilityNote(5, 5, 7)).toBeNull();
    expect(availabilityNote(5, 1, 0)).toBeNull();
  });

  it('gives the usual delivery time for an out-of-stock product', () => {
    expect(availabilityNote(0, 1, 7)).toBe('Out of stock: usually delivered in about 7 days.');
    expect(availabilityNote(0, 1, 1)).toBe('Out of stock: usually delivered in about 1 day.');
  });

  it('uses the default lead time when none is set, never "ask us"', () => {
    expect(availabilityNote(0, 2, 0)).toBe('Out of stock: usually delivered in about 7 days.');
    expect(leadTimeDays(0)).toBe(7);
    expect(leadTimeDays(null)).toBe(7);
    expect(leadTimeDays(3)).toBe(3);
  });

  it('explains a quantity above what is in stock', () => {
    expect(availabilityNote(3, 10, 5)).toBe('Only 3 in stock: the rest usually take about 5 days.');
    expect(availabilityNote(3, 10, 0)).toBe('Only 3 in stock: the rest usually take about 7 days.');
  });
});

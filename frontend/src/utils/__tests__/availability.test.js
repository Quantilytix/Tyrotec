import { describe, expect, it } from 'vitest';
import { availabilityNote, leadTimeDays, longestLeadTime } from '../availability';

describe('availabilityNote', () => {
  it('says nothing when stock covers the quantity', () => {
    expect(availabilityNote(5, 5, 7)).toBeNull();
  });

  it('gives the usual delivery time for an out-of-stock product', () => {
    expect(availabilityNote(0, 1, 7)).toBe('Out of stock: usually delivered in about 7 days.');
  });

  it('uses the default lead time when none is set, never "ask us"', () => {
    expect(availabilityNote(0, 1, 0)).toBe('Out of stock: usually delivered in about 7 days.');
    expect(leadTimeDays(0)).toBe(7);
  });

  it('explains a quantity above what is in stock', () => {
    expect(availabilityNote(3, 10, 1)).toBe('Only 3 in stock: the rest usually take about 1 day.');
  });
});

describe('longestLeadTime', () => {
  it('returns the longest lead time, counting unset ones as the default', () => {
    expect(longestLeadTime([{ lead_time_days: 3 }, { lead_time_days: 10 }])).toBe(10);
    expect(longestLeadTime([{ lead_time_days: 0 }])).toBe(7);
    expect(longestLeadTime([])).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { discountLabel } from '../discounts';

describe('discountLabel', () => {
  it('words a discount with its reason', () => {
    expect(discountLabel(15, 'Clearance')).toBe('15% off: Clearance');
    expect(discountLabel('12.5', '')).toBe('12.50% off');
  });
});

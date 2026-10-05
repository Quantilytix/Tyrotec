import { describe, it, expect } from 'vitest';
import { recordPage } from '../qxLinks';

const ID = '3f2a9c1e-1111-4222-8333-444455556666';

describe('recordPage (View in Tyrotec from QX)', () => {
  it('opens the record for types with a detail page', () => {
    expect(recordPage('order', ID)).toBe(`/admin/orders/${ID}`);
    expect(recordPage('quote', ID)).toBe(`/admin/quotes/${ID}`);
    expect(recordPage('customer', ID)).toBe(`/admin/customers/${ID}`);
    expect(recordPage('purchase', ID)).toBe(`/admin/purchases/${ID}`);
  });

  it('opens the list for types without one', () => {
    expect(recordPage('product', ID)).toBe('/admin/products');
    expect(recordPage('supplier', ID)).toBe('/admin/suppliers');
  });

  it('never builds a path from anything but a real id', () => {
    expect(recordPage('order', '../../logout')).toBe('/admin/orders');
    expect(recordPage('order', `${ID}/x`)).toBe('/admin/orders');
    expect(recordPage('order', null)).toBe('/admin/orders');
  });

  it('plain "Open Tyrotec" (no record) and unknown types go home', () => {
    expect(recordPage(null, null)).toBe('/');
    expect(recordPage('payroll', ID)).toBe('/');
  });
});

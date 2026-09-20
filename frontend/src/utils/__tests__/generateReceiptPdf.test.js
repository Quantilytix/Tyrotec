import { describe, it, expect } from 'vitest';
import { getReceiptPayment, receiptTotals, receiptNumber, buildReceiptDoc } from '../generateReceiptPdf';

const payment = (overrides) => ({
  id: 'p1',
  status: 'approved',
  method: 'payfast',
  amount: 340,
  created_at: '2026-09-02T21:02:00Z',
  ...overrides,
});

describe('getReceiptPayment', () => {
  it('returns the approved payment for a confirmed, ready or completed order', () => {
    for (const status of ['confirmed', 'ready_for_collection', 'completed']) {
      expect(getReceiptPayment({ status, payments: [payment()] })?.id).toBe('p1');
    }
  });

  it('returns null before the order is confirmed, even if a payment exists', () => {
    for (const status of ['pending_approval', 'approved', 'processing', 'stock_reserved', 'cancelled']) {
      expect(getReceiptPayment({ status, payments: [payment()] })).toBeNull();
    }
  });

  it('never issues a receipt against a payment that is not approved', () => {
    const order = { status: 'confirmed', payments: [payment({ status: 'submitted' }), payment({ status: 'rejected' })] };
    expect(getReceiptPayment(order)).toBeNull();
    expect(getReceiptPayment({ status: 'confirmed' })).toBeNull();
    expect(getReceiptPayment(null)).toBeNull();
  });

  it('picks the most recent approved payment', () => {
    const order = {
      status: 'completed',
      payments: [payment({ id: 'old', created_at: '2026-01-01T00:00:00Z' }), payment({ id: 'new', created_at: '2026-02-01T00:00:00Z' })],
    };
    expect(getReceiptPayment(order).id).toBe('new');
  });
});

describe('receiptTotals', () => {
  // Prices are quoted excluding VAT, so the receipt states the VAT the order
  // actually charged rather than deriving it from the total.
  it('uses the order\'s own stored VAT figures', () => {
    const order = { subtotal_amount: 200, vat_amount: 30, total_amount: 230 };
    expect(receiptTotals(order, 230)).toEqual({
      subtotalExclVat: 200,
      vat: 30,
      total: 230,
      paid: 230,
      balance: 0,
      legacy: false,
    });
  });

  // Orders placed before VAT-exclusive pricing have no stored breakdown: their
  // prices included VAT, and the receipt must keep printing as it always did.
  it('works a legacy order\'s VAT back out of its inclusive total', () => {
    expect(receiptTotals({ total_amount: 340 }, 340)).toMatchObject({
      subtotalExclVat: 295.65,
      vat: 44.35,
      total: 340,
      legacy: true,
    });
  });

  it('keeps subtotal + VAT equal to the total to the cent', () => {
    const t = receiptTotals({ total_amount: 47970.5 }, 47970.5);
    expect(Math.round((t.subtotalExclVat + t.vat) * 100)).toBe(4797050);
  });

  it('reports an outstanding balance for a short payment, never a negative one for an overpayment', () => {
    const order = { subtotal_amount: 1739.13, vat_amount: 260.87, total_amount: 2000 };
    expect(receiptTotals(order, 1500).balance).toBe(500);
    expect(receiptTotals(order, 2500).balance).toBe(0);
  });
});

describe('receipt document', () => {
  it('pads the receipt number from the order number', () => {
    expect(receiptNumber(52)).toBe('RCT-00052');
  });

  it('builds a PDF for a paid order without a logo', () => {
    const order = {
      order_number: 47,
      status: 'confirmed',
      total_amount: 340,
      users: { email: 'buyer@example.com', company_name: 'Buyer Co' },
      order_items: [{ quantity: 1, unit_price: 340, products: { name: 'Cable', sku: 'CBL-1' } }],
    };
    const doc = buildReceiptDoc({ order, payment: payment({ gateway_reference: '3363125' }), logoDataUri: null });
    expect(doc.internal.getNumberOfPages()).toBe(1);
    expect(doc.output().startsWith('%PDF')).toBe(true);
  });
});

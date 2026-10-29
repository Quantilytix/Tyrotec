const { generateInvoicePdfBuffer, generateQuotePdfBuffer, invoicePaymentStatus } = require('../quotePdfService');
const { invoiceLabel, saleLabel } = require('../../utils/invoiceNumber');

const ORDER = {
  id: 'o-1',
  order_number: 57,
  invoice_number: 3,
  status: 'approved',
  created_at: '2026-10-28T08:00:00Z',
  subtotal_amount: 1000,
  vat_amount: 150,
  total_amount: 1150,
  payments: [],
};
const ITEMS = [{ quantity: 1, unit_price: 1000, vat_rate: 15, products: { name: 'Pump', sku: 'P-1' } }];

describe('invoice numbers', () => {
  it('pads to four digits with an INV- prefix', () => {
    expect(invoiceLabel(3)).toBe('INV-0003');
    expect(invoiceLabel(12345)).toBe('INV-12345');
  });

  it('names an invoice by its invoice number and an order by its order number', () => {
    expect(saleLabel(ORDER)).toBe('invoice INV-0003');
    expect(saleLabel({ order_number: 57 })).toBe('order #57');
  });
});

describe('invoicePaymentStatus', () => {
  it('is Unpaid with no approved payment', () => {
    expect(invoicePaymentStatus({ ...ORDER, payments: [{ amount: 1150, status: 'submitted' }] }).label).toBe('Unpaid');
  });

  it('is Part paid when approved payments cover some of it', () => {
    expect(invoicePaymentStatus({ ...ORDER, payments: [{ amount: 500, status: 'approved' }] }).label).toBe('Part paid');
  });

  it('is Paid when approved payments cover the total', () => {
    expect(invoicePaymentStatus({ ...ORDER, payments: [{ amount: 1150, status: 'approved' }] }).label).toBe('Paid');
  });

  it('is Cancelled for a cancelled invoice, whatever was paid', () => {
    expect(invoicePaymentStatus({ ...ORDER, status: 'cancelled', payments: [{ amount: 1150, status: 'approved' }] }).label).toBe('Cancelled');
  });
});

describe('PDFs', () => {
  it('makes a tax invoice PDF', () => {
    const pdf = generateInvoicePdfBuffer({ order: ORDER, items: ITEMS, customer: { email: 'buyer@example.com' } });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('still makes a quotation PDF', () => {
    const pdf = generateQuotePdfBuffer({ quote: { quote_number: 9, status: 'submitted', ...ORDER }, items: ITEMS, customer: {} });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

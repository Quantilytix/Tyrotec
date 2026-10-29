// Staff-made sales are invoices with their own number (orders.invoice_number),
// shown as INV-0001. Matches backend/src/utils/invoiceNumber.js.
export function invoiceLabel(invoiceNumber) {
  return `INV-${String(invoiceNumber).padStart(4, '0')}`;
}

// The heading for a sale: "Invoice INV-0001" or "Order #57".
export function saleTitle(order) {
  return order?.invoice_number ? `Invoice ${invoiceLabel(order.invoice_number)}` : `Order #${order?.order_number}`;
}

export const isInvoice = (order) => Boolean(order?.invoice_number);

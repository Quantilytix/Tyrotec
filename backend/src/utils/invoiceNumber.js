// Staff-made sales are invoices with their own number (orders.invoice_number,
// 042), shown as INV-0001. Matches frontend/src/utils/invoiceNumber.js.
function invoiceLabel(invoiceNumber) {
  return `INV-${String(invoiceNumber).padStart(4, '0')}`;
}

// How a sale is named to people: "invoice INV-0001" or "order #57".
function saleLabel(order) {
  return order?.invoice_number ? `invoice ${invoiceLabel(order.invoice_number)}` : `order #${order?.order_number}`;
}

module.exports = { invoiceLabel, saleLabel };

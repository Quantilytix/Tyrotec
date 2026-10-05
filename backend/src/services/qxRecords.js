// Turns portal rows into the records QX's Connected Systems API takes
// (quantnow docs/CONNECTED_SYSTEMS_API.md). Pure functions: the sync job
// (qxSyncService.js) loads the rows, these shape them.
//
// Amounts: prices and costs here exclude VAT, so documents are sent with
// prices_include_vat false -- except legacy quotes/orders priced before VAT
// was split out (subtotal_amount is null), whose prices already include it.

const TIMEZONE = 'Africa/Johannesburg';

// A timestamp as the calendar date it was in South Africa ('YYYY-MM-DD').
function localDate(timestamp) {
  if (!timestamp) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(timestamp));
}

const num = (v) => (v === null || v === undefined ? null : Number(v));

function customerRecord(user) {
  return {
    name: user.company_name || user.full_name || user.email,
    contact_person: user.company_name ? user.full_name || null : null,
    email: user.email,
    phone: user.phone || null,
    address: user.address || null,
    vat_number: user.vat_number || null,
  };
}

function supplierRecord(supplier) {
  return {
    name: supplier.name,
    email: supplier.email || null,
    phone: supplier.phone || null,
    address: supplier.location || null,
    vat_number: supplier.vat_number || null,
    credit_terms_days: supplier.credit_terms_days,
  };
}

// Tyrotec sells products only, so every product is stock (never a service).
function productRecord(product) {
  return {
    sku: product.sku,
    name: product.name,
    description: product.description || null,
    category: product.category,
    unit_price: num(product.unit_price),
    vat_rate: product.vat_applicable === false ? 0 : 15,
    cost_price: num(product.supplier_cost),
    stock_quantity: product.stock_quantity,
    is_service: false,
    supplier_name: product.supplier_name || null,
  };
}

function documentLines(items, legacyVatInclusive) {
  return (items || []).map((item) => ({
    product_id: item.product_id,
    name: item.product?.name || null,
    description: item.product ? `${item.product.sku} – ${item.product.name}` : null,
    quantity: item.quantity,
    unit_price: num(item.unit_price),
    // Legacy lines carry no rate; their price includes 15% VAT.
    vat_rate: legacyVatInclusive ? 15 : num(item.vat_rate) ?? 15,
  }));
}

function quoteRecord(quote) {
  const legacy = quote.subtotal_amount === null || quote.subtotal_amount === undefined;
  return {
    number: quote.quote_number,
    date: localDate(quote.created_at),
    status: quote.status,
    customer_id: quote.customer_id,
    prices_include_vat: legacy,
    total: num(quote.total_amount),
    lines: documentLines(quote.quote_items, legacy),
  };
}

function orderRecord(order) {
  const legacy = order.subtotal_amount === null || order.subtotal_amount === undefined;
  return {
    number: order.order_number,
    quote_id: order.quote_id,
    customer_id: order.customer_id,
    // The day it became a sale (approved, paid, ...), which is the invoice
    // date in QX; the day it was placed until then.
    date: localDate(order.committed_at || order.created_at),
    status: order.status,
    prices_include_vat: legacy,
    total: num(order.total_amount),
    lines: documentLines(order.order_items, legacy),
  };
}

function paymentRecord(payment) {
  return {
    order_id: payment.order_id,
    amount: num(payment.amount),
    date: localDate(payment.verified_at || payment.reviewed_at || payment.created_at),
    method: payment.method,
    gateway: payment.gateway,
    reference: payment.reference,
    status: payment.status,
  };
}

function purchaseRecord(purchase) {
  return {
    supplier_id: purchase.supplier_id,
    supplier_invoice_number: purchase.supplier_invoice_number,
    date: purchase.purchase_date,
    due_date: purchase.due_date || null,
    lines: (purchase.purchase_items || []).map((item) => ({
      product_id: item.product_id,
      quantity: item.quantity,
      unit_cost: num(item.unit_cost),
      vat_rate: num(item.vat_rate),
    })),
  };
}

function stockAdjustmentRecord(adjustment) {
  return {
    product_id: adjustment.product_id,
    quantity_change: adjustment.quantity_change,
    unit_cost: num(adjustment.unit_cost),
    reason: adjustment.reason,
    date: localDate(adjustment.created_at),
  };
}

function openingStockRecord(opening) {
  return {
    date: opening.as_of_date,
    lines: (opening.lines || []).map((line) => ({
      product_id: line.product_id,
      quantity: line.quantity,
      unit_cost: num(line.unit_cost),
    })),
  };
}

module.exports = {
  localDate,
  customerRecord,
  supplierRecord,
  productRecord,
  quoteRecord,
  orderRecord,
  paymentRecord,
  purchaseRecord,
  stockAdjustmentRecord,
  openingStockRecord,
};

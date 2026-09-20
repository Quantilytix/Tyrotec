// Excel (.xlsx) exports for the admin Products, Quotes, and Orders screens.
//
// Built server-side with ExcelJS (already a dependency, used to read the
// spreadsheets the product import accepts) rather than in the browser: the
// admin list pages hold only what they've loaded, while an export has to be
// the complete, current set of matching records.
//
// Money is written as a real number with a rand format, and dates as real
// dates, so the recipient can sum a column or filter by month in Excel --
// which is the entire point of exporting rather than copying the screen.

const ExcelJS = require('exceljs');
const { displayTotals, lineTotals } = require('../utils/vat');

const CURRENCY_FORMAT = '"R"#,##0.00';
const DATE_FORMAT = 'yyyy-mm-dd hh:mm';
const HEADER_FILL = 'FF1E3A66'; // the portal's navy (--color-teal-500)

function addSheet(workbook, name, columns, rows) {
  const sheet = workbook.addWorksheet(name, {
    views: [{ state: 'frozen', ySplit: 1 }], // keep headers visible while scrolling
  });

  sheet.columns = columns.map(({ header, key, width, format }) => ({
    header,
    key,
    width: width || Math.max(header.length + 4, 14),
    style: format ? { numFmt: format } : undefined,
  }));

  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
  sheet.getRow(1).alignment = { vertical: 'middle' };
  sheet.getRow(1).height = 20;

  rows.forEach((row) => sheet.addRow(row));

  // Excel's own filter dropdowns on every column, so whoever opens the file
  // can slice it without us shipping a filter per column in the UI.
  if (rows.length > 0) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  }

  return sheet;
}

function toDate(value) {
  return value ? new Date(value) : null;
}

function customerName(record) {
  return record.users?.company_name || record.users?.email || 'Unknown customer';
}

// Titles the way staff read them on screen: "ready_for_collection" ->
// "Ready for collection".
function humanise(value) {
  if (!value) return '';
  const text = String(value).replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// A few statuses are worded differently in the portal than in the database.
// Mirrors frontend/src/utils/statusLabels.js so a downloaded file says the
// same thing as the screen it was exported from.
const STATUS_LABELS = {
  submitted: 'Quote Finalized',
  confirmed: 'Paid',
};

function statusLabel(status) {
  return STATUS_LABELS[status] || humanise(status);
}

function buildProductsWorkbook(products) {
  const workbook = new ExcelJS.Workbook();

  // Deliberately no supplier name/contact/cost and no margin: this file gets
  // forwarded to customers and suppliers, and that information is internal.
  addSheet(
    workbook,
    'Products',
    [
      { header: 'SKU', key: 'sku', width: 18 },
      { header: 'Name', key: 'name', width: 40 },
      { header: 'Category', key: 'category', width: 22 },
      { header: 'Description', key: 'description', width: 50 },
      { header: 'Unit price (excl. VAT)', key: 'unit_price', width: 20, format: CURRENCY_FORMAT },
      { header: 'VAT applies', key: 'vat_applicable', width: 12 },
      { header: 'Stock on hand', key: 'stock_quantity', width: 15 },
      { header: 'Stock value', key: 'stock_value', width: 18, format: CURRENCY_FORMAT },
      { header: 'Availability', key: 'availability', width: 14 },
      { header: 'Min order qty', key: 'min_order_qty', width: 14 },
    ],
    products.map((product) => ({
      sku: product.sku,
      name: product.name,
      category: product.category,
      description: product.description || '',
      unit_price: Number(product.unit_price) || 0,
      vat_applicable: product.vat_applicable === false ? 'No' : 'Yes',
      stock_quantity: product.stock_quantity,
      stock_value: (Number(product.unit_price) || 0) * (Number(product.stock_quantity) || 0),
      availability: humanise(product.availability),
      min_order_qty: product.min_order_qty,
    }))
  );

  return workbook;
}

function buildQuotesWorkbook(quotes) {
  const workbook = new ExcelJS.Workbook();

  addSheet(
    workbook,
    'Quotes',
    [
      { header: 'Quote number', key: 'quote_number', width: 15 },
      { header: 'Date', key: 'created_at', width: 18, format: DATE_FORMAT },
      { header: 'Customer', key: 'customer', width: 30 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Source', key: 'source', width: 12 },
      { header: 'Items', key: 'item_count', width: 10 },
      { header: 'Subtotal (excl. VAT)', key: 'subtotal_amount', width: 20, format: CURRENCY_FORMAT },
      { header: 'VAT', key: 'vat_amount', width: 14, format: CURRENCY_FORMAT },
      { header: 'Total (incl. VAT)', key: 'total_amount', width: 18, format: CURRENCY_FORMAT },
    ],
    quotes.map((quote) => ({
      quote_number: quote.quote_number,
      created_at: toDate(quote.created_at),
      customer: customerName(quote),
      email: quote.users?.email || '',
      status: statusLabel(quote.status),
      source: humanise(quote.source),
      item_count: (quote.quote_items || []).length,
      // Legacy documents priced VAT-inclusive have their breakdown worked back
      // out, so every row of the sheet is comparable.
      subtotal_amount: displayTotals(quote).subtotal_amount,
      vat_amount: displayTotals(quote).vat_amount,
      total_amount: displayTotals(quote).total_amount,
    }))
  );

  // One row per product line, so a month's quotes can be pivoted by product.
  const itemRows = quotes.flatMap((quote) =>
    (quote.quote_items || []).map((item) => ({
      quote_number: quote.quote_number,
      created_at: toDate(quote.created_at),
      customer: customerName(quote),
      sku: item.products?.sku || '',
      product: item.products?.name || '',
      quantity: item.quantity,
      unit_price: Number(item.unit_price) || 0,
      // null rate = a legacy line whose price already included VAT.
      vat_rate: item.vat_rate === null || item.vat_rate === undefined ? 'n/a' : Number(item.vat_rate),
      line_total: lineTotals(item).net,
      line_vat: lineTotals(item).vat,
    }))
  );

  addSheet(
    workbook,
    'Quote items',
    [
      { header: 'Quote number', key: 'quote_number', width: 15 },
      { header: 'Date', key: 'created_at', width: 18, format: DATE_FORMAT },
      { header: 'Customer', key: 'customer', width: 30 },
      { header: 'SKU', key: 'sku', width: 18 },
      { header: 'Product', key: 'product', width: 40 },
      { header: 'Quantity', key: 'quantity', width: 12 },
      { header: 'Unit price (excl. VAT)', key: 'unit_price', width: 20, format: CURRENCY_FORMAT },
      { header: 'VAT %', key: 'vat_rate', width: 10 },
      { header: 'Line total (excl. VAT)', key: 'line_total', width: 20, format: CURRENCY_FORMAT },
      { header: 'Line VAT', key: 'line_vat', width: 14, format: CURRENCY_FORMAT },
    ],
    itemRows
  );

  return workbook;
}

// The payment that represents how an order was actually paid: an approved one
// if there is one, otherwise the most recent attempt, so a pending or rejected
// payment still shows up rather than leaving the columns blank.
function relevantPayment(order) {
  const payments = order.payments || [];
  if (payments.length === 0) return null;
  return (
    payments.find((payment) => payment.status === 'approved') ||
    [...payments].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
  );
}

function buildOrdersWorkbook(orders) {
  const workbook = new ExcelJS.Workbook();

  addSheet(
    workbook,
    'Orders',
    [
      { header: 'Order number', key: 'order_number', width: 15 },
      { header: 'Date', key: 'created_at', width: 18, format: DATE_FORMAT },
      { header: 'Customer', key: 'customer', width: 30 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Status', key: 'status', width: 20 },
      { header: 'Source', key: 'source', width: 12 },
      { header: 'Items', key: 'item_count', width: 10 },
      { header: 'Subtotal (excl. VAT)', key: 'subtotal_amount', width: 20, format: CURRENCY_FORMAT },
      { header: 'VAT', key: 'vat_amount', width: 14, format: CURRENCY_FORMAT },
      { header: 'Total (incl. VAT)', key: 'total_amount', width: 18, format: CURRENCY_FORMAT },
      { header: 'Payment method', key: 'payment_method', width: 18 },
      { header: 'Payment status', key: 'payment_status', width: 16 },
      { header: 'Payment reference', key: 'payment_reference', width: 24 },
      { header: 'Paid on', key: 'paid_at', width: 18, format: DATE_FORMAT },
    ],
    orders.map((order) => {
      const payment = relevantPayment(order);
      return {
        order_number: order.order_number,
        created_at: toDate(order.created_at),
        customer: customerName(order),
        email: order.users?.email || '',
        status: statusLabel(order.status),
        source: humanise(order.source),
        item_count: (order.order_items || []).length,
        subtotal_amount: displayTotals(order).subtotal_amount,
        vat_amount: displayTotals(order).vat_amount,
        total_amount: displayTotals(order).total_amount,
        payment_method: payment ? humanise(payment.method) : '',
        payment_status: payment ? humanise(payment.status) : 'Not paid',
        payment_reference: payment ? payment.gateway_reference || payment.reference || '' : '',
        paid_at: payment ? toDate(payment.verified_at || payment.reviewed_at) : null,
      };
    })
  );

  const itemRows = orders.flatMap((order) =>
    (order.order_items || []).map((item) => ({
      order_number: order.order_number,
      created_at: toDate(order.created_at),
      customer: customerName(order),
      status: statusLabel(order.status),
      sku: item.products?.sku || '',
      product: item.products?.name || '',
      quantity: item.quantity,
      unit_price: Number(item.unit_price) || 0,
      // null rate = a legacy line whose price already included VAT.
      vat_rate: item.vat_rate === null || item.vat_rate === undefined ? 'n/a' : Number(item.vat_rate),
      line_total: lineTotals(item).net,
      line_vat: lineTotals(item).vat,
    }))
  );

  addSheet(
    workbook,
    'Order items',
    [
      { header: 'Order number', key: 'order_number', width: 15 },
      { header: 'Date', key: 'created_at', width: 18, format: DATE_FORMAT },
      { header: 'Customer', key: 'customer', width: 30 },
      { header: 'Order status', key: 'status', width: 20 },
      { header: 'SKU', key: 'sku', width: 18 },
      { header: 'Product', key: 'product', width: 40 },
      { header: 'Quantity', key: 'quantity', width: 12 },
      { header: 'Unit price (excl. VAT)', key: 'unit_price', width: 20, format: CURRENCY_FORMAT },
      { header: 'VAT %', key: 'vat_rate', width: 10 },
      { header: 'Line total (excl. VAT)', key: 'line_total', width: 20, format: CURRENCY_FORMAT },
      { header: 'Line VAT', key: 'line_vat', width: 14, format: CURRENCY_FORMAT },
    ],
    itemRows
  );

  return workbook;
}

// Streams a finished workbook as a download. Named with the date so a folder
// of exports stays sortable.
async function sendWorkbook(res, workbook, baseName) {
  const filename = `${baseName}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  // The frontend reads the filename from this header, which browsers only
  // expose cross-origin when it's explicitly allowed.
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  await workbook.xlsx.write(res);
  res.end();
}

module.exports = {
  statusLabel,
  buildProductsWorkbook,
  buildQuotesWorkbook,
  buildOrdersWorkbook,
  sendWorkbook,
  humanise,
  relevantPayment,
};

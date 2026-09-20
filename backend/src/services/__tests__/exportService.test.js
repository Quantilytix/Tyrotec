const ExcelJS = require('exceljs');
const {
  buildProductsWorkbook,
  buildQuotesWorkbook,
  buildOrdersWorkbook,
  relevantPayment,
  statusLabel,
} = require('../exportService');

// Reads a generated workbook back through ExcelJS, the way Excel would, so
// these assert what actually lands in the file rather than what we passed in.
async function roundTrip(workbook) {
  const buffer = await workbook.xlsx.writeBuffer();
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(buffer);
  return reopened;
}

const headersOf = (sheet) => sheet.getRow(1).values.slice(1);
const rowValues = (sheet, rowNumber) => sheet.getRow(rowNumber).values.slice(1);

const PRODUCT = {
  sku: 'DRL-1001',
  name: 'Drill Rig Carbide Button Bit 89mm',
  category: 'Rock Drills',
  description: 'Tungsten carbide',
  unit_price: '1250.50',
  stock_quantity: 4,
  availability: 'local',
  lead_time_days: 7,
  min_order_qty: 1,
  supplier_name: 'Acme Supplies',
  supplier_cost: '900',
};

const QUOTE = {
  quote_number: 12,
  created_at: '2026-08-14T09:30:00Z',
  status: 'submitted',
  source: 'whatsapp',
  total_amount: '2501',
  users: { email: 'buyer@example.com', company_name: 'Buyer Co' },
  quote_items: [
    { quantity: 2, unit_price: '1250.50', products: { name: 'Button Bit', sku: 'DRL-1001' } },
  ],
};

const ORDER = {
  order_number: 52,
  created_at: '2026-08-15T09:30:00Z',
  status: 'ready_for_collection',
  source: 'portal',
  total_amount: '340',
  users: { email: 'buyer@example.com', company_name: 'Buyer Co' },
  order_items: [{ quantity: 1, unit_price: '340', products: { name: 'Cable', sku: 'CBL-5005' } }],
  payments: [
    {
      status: 'approved',
      method: 'payfast',
      gateway_reference: '3365147',
      verified_at: '2026-08-15T10:00:00Z',
      created_at: '2026-08-15T09:59:00Z',
    },
  ],
};

describe('buildProductsWorkbook', () => {
  it('never exposes supplier details or cost, and drops lead time', async () => {
    const sheet = (await roundTrip(buildProductsWorkbook([PRODUCT]))).getWorksheet('Products');
    const headers = headersOf(sheet).join('|');

    expect(headers).not.toMatch(/supplier/i);
    expect(headers).not.toMatch(/cost/i);
    expect(headers).not.toMatch(/margin/i);
    expect(headers).not.toMatch(/lead/i);
    // And no stray value smuggled into another column.
    expect(rowValues(sheet, 2)).not.toContain('Acme Supplies');
  });

  it('writes prices as numbers with a rand format, so Excel can sum them', async () => {
    const sheet = (await roundTrip(buildProductsWorkbook([PRODUCT]))).getWorksheet('Products');
    const price = sheet.getRow(2).getCell(5);

    expect(price.value).toBe(1250.5);
    expect(price.numFmt).toContain('R');
  });

  it('includes stock value so a stocktake total is one click away', async () => {
    const sheet = (await roundTrip(buildProductsWorkbook([PRODUCT]))).getWorksheet('Products');
    const headers = headersOf(sheet);
    const stockValue = sheet.getRow(2).getCell(headers.indexOf('Stock value') + 1);
    expect(stockValue.value).toBe(1250.5 * 4);
  });

  it('prices are labelled excluding VAT, and says whether VAT applies', async () => {
    const sheet = (await roundTrip(buildProductsWorkbook([PRODUCT, { ...PRODUCT, vat_applicable: false }])))
      .getWorksheet('Products');
    const headers = headersOf(sheet);
    const vatColumn = headers.indexOf('VAT applies') + 1;

    expect(headers).toContain('Unit price (excl. VAT)');
    expect(sheet.getRow(2).getCell(vatColumn).value).toBe('Yes');
    expect(sheet.getRow(3).getCell(vatColumn).value).toBe('No');
  });
});

describe('buildQuotesWorkbook', () => {
  it('has a summary sheet and a line-item sheet', async () => {
    const workbook = await roundTrip(buildQuotesWorkbook([QUOTE]));
    expect(workbook.worksheets.map((s) => s.name)).toEqual(['Quotes', 'Quote items']);
  });

  it('summarises each quote with its customer, item count and totals', async () => {
    const quote = { ...QUOTE, subtotal_amount: 2501, vat_amount: 375.15, total_amount: 2876.15 };
    const sheet = (await roundTrip(buildQuotesWorkbook([quote]))).getWorksheet('Quotes');
    const [number, date, customer, email, status, source, itemCount, subtotal, vat, total] = rowValues(sheet, 2);

    expect(number).toBe(12);
    expect(new Date(date).toISOString()).toBe('2026-08-14T09:30:00.000Z');
    expect(customer).toBe('Buyer Co');
    expect(email).toBe('buyer@example.com');
    // The portal's own wording for these statuses, not the raw database value
    // -- see statusLabel in exportService.js.
    expect(status).toBe('Quote Finalized');
    expect(source).toBe('Whatsapp');
    expect(itemCount).toBe(1);
    expect(subtotal).toBe(2501);
    expect(vat).toBe(375.15);
    expect(total).toBe(2876.15);
  });

  // Quotes written before VAT-exclusive pricing have no stored breakdown, so
  // the sheet works it back out of their inclusive total instead of showing
  // blanks next to the newer rows.
  it('breaks down a legacy VAT-inclusive quote', async () => {
    const sheet = (await roundTrip(buildQuotesWorkbook([{ ...QUOTE, total_amount: 115 }]))).getWorksheet('Quotes');
    const [, , , , , , , subtotal, vat, total] = rowValues(sheet, 2);

    expect(subtotal).toBe(100);
    expect(vat).toBe(15);
    expect(total).toBe(115);
  });

  it('records the VAT rate charged on each line', async () => {
    const quote = {
      ...QUOTE,
      quote_items: [
        { quantity: 2, unit_price: '100', vat_rate: 15, products: { name: 'Bit', sku: 'A1' } },
        { quantity: 1, unit_price: '100', vat_rate: 0, products: { name: 'Service', sku: 'S1' } },
      ],
    };
    const sheet = (await roundTrip(buildQuotesWorkbook([quote]))).getWorksheet('Quote items');
    const headers = headersOf(sheet);
    const rateColumn = headers.indexOf('VAT %') + 1;
    const vatColumn = headers.indexOf('Line VAT') + 1;

    expect(sheet.getRow(2).getCell(rateColumn).value).toBe(15);
    expect(sheet.getRow(2).getCell(vatColumn).value).toBe(30);
    expect(sheet.getRow(3).getCell(rateColumn).value).toBe(0);
    expect(sheet.getRow(3).getCell(vatColumn).value).toBe(0);
  });

  it('expands every line item with its own line total', async () => {
    const sheet = (await roundTrip(buildQuotesWorkbook([QUOTE]))).getWorksheet('Quote items');
    expect(rowValues(sheet, 2)).toEqual(
      expect.arrayContaining(['DRL-1001', 'Button Bit', 2, 1250.5, 2501])
    );
  });

  it('handles a quote with no items without inventing a row', async () => {
    const workbook = await roundTrip(buildQuotesWorkbook([{ ...QUOTE, quote_items: [] }]));
    expect(workbook.getWorksheet('Quotes').rowCount).toBe(2); // header + the quote
    expect(workbook.getWorksheet('Quote items').rowCount).toBe(1); // header only
  });
});

describe('buildOrdersWorkbook', () => {
  it('reports how each order was paid', async () => {
    const sheet = (await roundTrip(buildOrdersWorkbook([ORDER]))).getWorksheet('Orders');
    const values = rowValues(sheet, 2);

    expect(values[4]).toBe('Ready for collection');
    expect(values).toEqual(expect.arrayContaining(['Payfast', 'Approved', '3365147']));
  });

  it('marks an unpaid order rather than leaving the payment columns blank', async () => {
    const sheet = (await roundTrip(buildOrdersWorkbook([{ ...ORDER, payments: [] }]))).getWorksheet('Orders');
    expect(rowValues(sheet, 2)).toContain('Not paid');
  });
});

// Mirrors frontend/src/utils/statusLabels.js -- a file that said "Confirmed"
// where the screen says "Paid" would read like a different order.
describe('statusLabel', () => {
  it('uses the portal wording for the statuses that have one', () => {
    expect(statusLabel('submitted')).toBe('Quote Finalized');
    expect(statusLabel('confirmed')).toBe('Paid');
  });

  it('falls back to the readable version of the raw status', () => {
    expect(statusLabel('ready_for_collection')).toBe('Ready for collection');
    expect(statusLabel('cancelled')).toBe('Cancelled');
  });
});

describe('relevantPayment', () => {
  const approved = { status: 'approved', created_at: '2026-01-01T00:00:00Z' };
  const rejected = { status: 'rejected', created_at: '2026-02-01T00:00:00Z' };

  it('prefers the approved payment even when a later attempt exists', () => {
    expect(relevantPayment({ payments: [rejected, approved] })).toBe(approved);
  });

  it('falls back to the most recent attempt when none is approved', () => {
    const older = { status: 'submitted', created_at: '2026-01-01T00:00:00Z' };
    expect(relevantPayment({ payments: [older, rejected] })).toBe(rejected);
  });

  it('returns null when there are no payments at all', () => {
    expect(relevantPayment({ payments: [] })).toBeNull();
    expect(relevantPayment({})).toBeNull();
  });
});

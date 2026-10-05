jest.mock('../../config/supabase', () => ({ rpc: jest.fn() }));

const supabase = require('../../config/supabase');
const {
  publicProductView,
  validatePurchaseInput,
  validateAdjustmentInput,
  friendlyStockError,
  receivePurchase,
  adjustStock,
  recordOpeningStock,
} = require('../stockService');

const PURCHASE = {
  supplier_id: 'sup-1',
  supplier_invoice_number: ' BR-5531 ',
  purchase_date: '2026-10-02',
  lines: [{ product_id: 'p-1', quantity: 20, unit_cost: 619.999, vat_rate: 15 }],
};

describe('publicProductView', () => {
  it('drops supplier details and cost', () => {
    const view = publicProductView({
      id: 'p-1', sku: 'HV-220', name: 'Valve', unit_price: 1000, stock_quantity: 4,
      supplier_cost: 600, supplier_name: 'Bosch', supplier_email: 'x@y.z', supplier_id: 's-1',
    });
    expect(view).toEqual({ id: 'p-1', sku: 'HV-220', name: 'Valve', unit_price: 1000, stock_quantity: 4 });
  });
});

describe('validatePurchaseInput', () => {
  it('accepts a good purchase, trims the invoice number and rounds cost to cents', () => {
    const { value, error } = validatePurchaseInput(PURCHASE);
    expect(error).toBeUndefined();
    expect(value.supplier_invoice_number).toBe('BR-5531');
    expect(value.lines).toEqual([{ product_id: 'p-1', quantity: 20, unit_cost: 620, vat_rate: 15 }]);
    expect(value.due_date).toBeNull();
  });

  it('defaults a missing VAT rate to 15%', () => {
    const { value } = validatePurchaseInput({ ...PURCHASE, lines: [{ product_id: 'p-1', quantity: 1, unit_cost: 5 }] });
    expect(value.lines[0].vat_rate).toBe(15);
  });

  it.each([
    [{ supplier_id: '' }, 'Choose the supplier.'],
    [{ supplier_invoice_number: '  ' }, "Enter the supplier's invoice or delivery note number."],
    [{ purchase_date: '02/10/2026' }, 'Enter the date the goods arrived.'],
    [{ due_date: '2026-09-01' }, 'The due date is before the purchase date.'],
    [{ lines: [] }, 'Add at least one product.'],
    [{ lines: [{ product_id: 'p-1', quantity: 1.5, unit_cost: 1 }] }, 'Line 1: the quantity must be a whole number above 0.'],
    [{ lines: [{ product_id: 'p-1', quantity: 1, unit_cost: -1 }] }, 'Line 1: enter the unit cost (excl. VAT).'],
    [{ lines: [{ product_id: 'p-1', quantity: 1, unit_cost: 1, vat_rate: 14 }] }, 'Line 1: VAT must be 15% or 0%.'],
    [{ lines: [{ quantity: 1, unit_cost: 1 }] }, 'Line 1: choose a product.'],
  ])('rejects %j', (override, message) => {
    expect(validatePurchaseInput({ ...PURCHASE, ...override }).error).toBe(message);
  });
});

describe('validateAdjustmentInput', () => {
  const ADJ = { product_id: 'p-1', quantity_change: -2, reason: 'damaged' };

  it('accepts a write-off', () => {
    expect(validateAdjustmentInput(ADJ).value).toEqual({ product_id: 'p-1', quantity_change: -2, reason: 'damaged', note: null, unit_cost: null });
  });

  it.each([
    [{ quantity_change: 0 }, 'The change must be a whole number other than 0.'],
    [{ quantity_change: 1.5 }, 'The change must be a whole number other than 0.'],
    [{ reason: 'because' }, 'Choose a reason for the adjustment.'],
    [{ reason: 'other' }, 'Explain the adjustment in the note.'],
    [{ unit_cost: -3 }, 'The unit cost must be 0 or more.'],
  ])('rejects %j', (override, message) => {
    expect(validateAdjustmentInput({ ...ADJ, ...override }).error).toBe(message);
  });
});

describe('friendlyStockError', () => {
  it('explains a duplicate supplier invoice', () => {
    expect(friendlyStockError({ code: '23505', message: 'duplicate key value violates unique constraint "purchases_supplier_invoice_unique"' }))
      .toBe('This supplier invoice has already been captured.');
  });

  it.each([
    'Only 3 in stock; can\'t remove 5',
    'These products have stock but no cost: HV-220, HH-2M',
    'Opening stock has already been recorded',
  ])('passes the staff-readable message "%s" through', (message) => {
    expect(friendlyStockError({ message })).toBe(message);
  });

  it('hides anything unexpected', () => {
    expect(friendlyStockError({ message: 'relation "x" does not exist' })).toBe('Something went wrong. Please try again.');
  });
});

describe('RPC wrappers', () => {
  beforeEach(() => supabase.rpc.mockReset());

  it('receivePurchase passes every field to receive_purchase', async () => {
    supabase.rpc.mockResolvedValue({ data: 'pur-1', error: null });
    const { value } = validatePurchaseInput(PURCHASE);
    expect(await receivePurchase(value, 'user-1')).toEqual({ id: 'pur-1' });
    expect(supabase.rpc).toHaveBeenCalledWith('receive_purchase', {
      p_supplier_id: 'sup-1',
      p_supplier_invoice_number: 'BR-5531',
      p_purchase_date: '2026-10-02',
      p_due_date: null,
      p_notes: null,
      p_lines: value.lines,
      p_received_by: 'user-1',
    });
  });

  it('adjustStock returns a friendly 400 on a database refusal', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { message: "Only 1 in stock; can't remove 2" } });
    expect(await adjustStock({ product_id: 'p', quantity_change: -2, reason: 'lost', note: null, unit_cost: null }, 'u'))
      .toEqual({ error: "Only 1 in stock; can't remove 2", status: 400 });
  });

  it('recordOpeningStock needs a date and sends costs as an object', async () => {
    expect((await recordOpeningStock({ as_of_date: 'yesterday' }, 'u')).status).toBe(400);
    supabase.rpc.mockResolvedValue({ data: 'os-1', error: null });
    await recordOpeningStock({ as_of_date: '2026-09-30' }, 'u');
    expect(supabase.rpc).toHaveBeenCalledWith('record_opening_stock', { p_as_of_date: '2026-09-30', p_costs: {}, p_created_by: 'u' });
  });
});

// Purchases, stock adjustments and opening stock (032_suppliers_purchases_stock.sql).
//
// Stock no longer changes by typing a number on the product form. It goes up
// through a purchase (goods received from a supplier, at a cost) and is
// corrected through an adjustment with a reason; sales and cancellations keep
// using the order RPCs. Each of these runs in one database function, so stock,
// the weighted-average cost (products.supplier_cost) and the record of why
// always change together.

const supabase = require('../config/supabase');

const ADJUSTMENT_REASONS = ['damaged', 'lost', 'count_correction', 'returned_to_supplier', 'other'];

// Columns customers may see. Supplier details and costs are staff-only.
const PUBLIC_PRODUCT_FIELDS = [
  'id', 'sku', 'name', 'category', 'description', 'unit_price', 'vat_applicable', 'stock_quantity',
  'availability', 'lead_time_days', 'min_order_qty', 'image_url', 'created_at', 'updated_at',
];

function publicProductView(product) {
  if (!product) return product;
  const view = {};
  for (const field of PUBLIC_PRODUCT_FIELDS) {
    if (product[field] !== undefined) view[field] = product[field];
  }
  return view;
}

const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

// Checks a "record a purchase" request. Returns { value } or { error }.
function validatePurchaseInput(body = {}) {
  const supplierId = String(body.supplier_id || '').trim();
  const invoiceNumber = String(body.supplier_invoice_number || '').trim();
  if (!supplierId) return { error: 'Choose the supplier.' };
  if (!invoiceNumber) return { error: "Enter the supplier's invoice or delivery note number." };
  if (invoiceNumber.length > 100) return { error: 'The invoice number is too long.' };
  if (!isDate(body.purchase_date)) return { error: 'Enter the date the goods arrived.' };
  if (body.due_date && !isDate(body.due_date)) return { error: 'The due date is not a valid date.' };
  if (body.due_date && body.due_date < body.purchase_date) return { error: 'The due date is before the purchase date.' };

  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (lines.length === 0) return { error: 'Add at least one product.' };
  if (lines.length > 200) return { error: 'A purchase can have at most 200 lines.' };

  const cleaned = [];
  for (const [index, line] of lines.entries()) {
    const n = index + 1;
    const quantity = Number(line?.quantity);
    const unitCost = Number(line?.unit_cost);
    const vatRate = line?.vat_rate === undefined || line?.vat_rate === null ? 15 : Number(line.vat_rate);
    if (!Number.isInteger(quantity) || quantity <= 0) return { error: `Line ${n}: the quantity must be a whole number above 0.` };
    if (!Number.isFinite(unitCost) || unitCost < 0) return { error: `Line ${n}: enter the unit cost (excl. VAT).` };
    if (![0, 15].includes(vatRate)) return { error: `Line ${n}: VAT must be 15% or 0%.` };
    const base = { quantity, unit_cost: Math.round(unitCost * 100) / 100, vat_rate: vatRate };

    // A product that isn't in the catalogue yet: created with the purchase
    // (purchaseController.js), from the few details a product needs.
    if (!line?.product_id && line?.new_product) {
      const np = line.new_product;
      const sku = String(np.sku || '').trim();
      const name = String(np.name || '').trim();
      const category = String(np.category || '').trim();
      // Blank is not R0: Number('') would quietly price it at nothing.
      const unitPrice = np.unit_price === '' || np.unit_price == null ? NaN : Number(np.unit_price);
      const leadTime = Number(np.lead_time_days);
      if (!sku) return { error: `Line ${n}: enter the new product's SKU.` };
      if (!name) return { error: `Line ${n}: enter the new product's name.` };
      if (!category) return { error: `Line ${n}: choose the new product's category.` };
      if (!Number.isFinite(unitPrice) || unitPrice < 0) return { error: `Line ${n}: enter the new product's selling price (excl. VAT).` };
      if (!Number.isInteger(leadTime) || leadTime < 1) return { error: `Line ${n}: the lead time must be at least 1 day.` };
      cleaned.push({ ...base, new_product: { sku, name, category, unit_price: Math.round(unitPrice * 100) / 100, lead_time_days: leadTime } });
      continue;
    }
    if (!line?.product_id) return { error: `Line ${n}: choose a product.` };
    cleaned.push({ ...base, product_id: String(line.product_id) });
  }

  return {
    value: {
      supplier_id: supplierId,
      supplier_invoice_number: invoiceNumber,
      purchase_date: body.purchase_date,
      due_date: body.due_date || null,
      notes: body.notes ? String(body.notes).slice(0, 2000) : null,
      lines: cleaned,
    },
  };
}

function validateAdjustmentInput(body = {}) {
  const change = Number(body.quantity_change);
  if (!body.product_id) return { error: 'Choose the product.' };
  if (!Number.isInteger(change) || change === 0) return { error: 'The change must be a whole number other than 0.' };
  if (!ADJUSTMENT_REASONS.includes(body.reason)) return { error: 'Choose a reason for the adjustment.' };
  if (body.reason === 'other' && !String(body.note || '').trim()) return { error: 'Explain the adjustment in the note.' };
  const unitCost = body.unit_cost === undefined || body.unit_cost === null || body.unit_cost === '' ? null : Number(body.unit_cost);
  if (unitCost !== null && (!Number.isFinite(unitCost) || unitCost < 0)) return { error: 'The unit cost must be 0 or more.' };
  return {
    value: {
      product_id: String(body.product_id),
      quantity_change: change,
      reason: body.reason,
      note: body.note ? String(body.note).slice(0, 2000) : null,
      unit_cost: unitCost,
    },
  };
}

// The stock functions raise plain-text exceptions written for staff (see the
// migration). Pass those through; anything else gets a generic message.
const STAFF_READABLE = [
  /^Supplier not found or inactive$/,
  /^The supplier's invoice number is required$/,
  /^A purchase needs at least one line$/,
  /^Every line needs /,
  /^VAT rate must be 0 or 15$/,
  /^Product .* not found$/,
  /^Only \d+ in stock; can't remove \d+$/,
  /^.+ has no cost yet\. Enter its unit cost\.$/,
  /^Opening stock has already been recorded$/,
  /^These products have stock but no cost: /,
  /^The change must be /,
  /^Say why you are making this correction$/,
  /^Stock can't be below 0$/,
  /^The average cost can't be below 0$/,
  /has no average cost yet\. Enter it as well\.$/,
  /^Product not found$/,
];

function friendlyStockError(error) {
  if (!error) return 'Something went wrong. Please try again.';
  if (error.code === '23505' && /purchases_supplier_invoice_unique/.test(error.message || '')) {
    return "This supplier invoice has already been captured.";
  }
  const message = String(error.message || '');
  return STAFF_READABLE.some((re) => re.test(message)) ? message : 'Something went wrong. Please try again.';
}

async function receivePurchase(input, userId) {
  const { data, error } = await supabase.rpc('receive_purchase', {
    p_supplier_id: input.supplier_id,
    p_supplier_invoice_number: input.supplier_invoice_number,
    p_purchase_date: input.purchase_date,
    p_due_date: input.due_date,
    p_notes: input.notes,
    p_lines: input.lines,
    p_received_by: userId,
  });
  if (error) return { error: friendlyStockError(error), status: 400 };
  return { id: data };
}

async function adjustStock(input, userId) {
  const { data, error } = await supabase.rpc('adjust_stock', {
    p_product_id: input.product_id,
    p_quantity_change: input.quantity_change,
    p_reason: input.reason,
    p_note: input.note,
    p_unit_cost: input.unit_cost,
    p_created_by: userId,
  });
  if (error) return { error: friendlyStockError(error), status: 400 };
  return { id: data };
}

// A correction to a product's stock and/or average cost, made from the product
// form when a mistake slipped through (041_correct_stock_and_cost.sql). Blank
// means "leave as it is"; a note saying why is required.
function validateCorrectionInput(body = {}) {
  const productId = String(body.product_id || '').trim();
  const blank = (v) => v === undefined || v === null || v === '';
  const stock = blank(body.stock_quantity) ? null : Number(body.stock_quantity);
  const cost = blank(body.supplier_cost) ? null : Number(body.supplier_cost);
  const note = String(body.note || '').trim();
  if (!productId) return { error: 'Choose the product.' };
  if (stock === null && cost === null) return { error: 'Enter the correct stock or average cost.' };
  if (stock !== null && (!Number.isInteger(stock) || stock < 0)) return { error: 'Stock must be a whole number, 0 or more.' };
  if (cost !== null && (!Number.isFinite(cost) || cost < 0)) return { error: 'The average cost must be 0 or more.' };
  if (!note) return { error: 'Say why you are making this correction.' };
  if (note.length > 500) return { error: 'Keep the note under 500 characters.' };
  return {
    value: {
      product_id: productId,
      stock_quantity: stock,
      supplier_cost: cost === null ? null : Math.round(cost * 100) / 100,
      note,
    },
  };
}

async function correctStockAndCost(value, userId) {
  const { data, error } = await supabase.rpc('correct_stock_and_cost', {
    p_product_id: value.product_id,
    p_new_stock: value.stock_quantity,
    p_new_cost: value.supplier_cost,
    p_note: value.note,
    p_created_by: userId,
  });
  if (error) return { error: friendlyStockError(error), status: 400 };
  return { result: data };
}

async function recordOpeningStock({ as_of_date: asOfDate, costs }, userId) {
  if (!isDate(asOfDate)) return { error: 'Enter the date the stock count applies to.', status: 400 };
  const { data, error } = await supabase.rpc('record_opening_stock', {
    p_as_of_date: asOfDate,
    p_costs: costs && typeof costs === 'object' ? costs : {},
    p_created_by: userId,
  });
  if (error) return { error: friendlyStockError(error), status: 400 };
  return { id: data };
}

module.exports = {
  ADJUSTMENT_REASONS,
  PUBLIC_PRODUCT_FIELDS,
  publicProductView,
  validatePurchaseInput,
  validateAdjustmentInput,
  validateCorrectionInput,
  correctStockAndCost,
  friendlyStockError,
  receivePurchase,
  adjustStock,
  recordOpeningStock,
};

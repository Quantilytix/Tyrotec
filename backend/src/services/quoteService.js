const supabase = require('../config/supabase');
const { notifyInternalTeam } = require('./notificationService');
const { formatCurrency } = require('../utils/formatCurrency');
const { documentTotals, rateForProduct } = require('../utils/vat');

// Core logic behind creating a quote, shared by the portal's POST /quotes
// route and the WhatsApp quoteBuilding flow -- two front doors onto the same
// pipeline, not two implementations of it. `source` records which one was
// used (defaults to 'portal' so nothing changes for existing callers).
async function createQuoteForCustomer(customerId, customerLabel, items, source = 'portal') {
  if (!items || items.length === 0) {
    return { error: 'Quote items are required', status: 400 };
  }

  const productIds = items.map((i) => i.product_id);
  const { data: products, error: pErr } = await supabase
    .from('products')
    .select('id, unit_price, vat_applicable')
    .in('id', productIds);

  if (pErr) throw pErr;
  if (products.length !== new Set(productIds).size) {
    return { error: 'One or more products were not found', status: 400 };
  }

  const productMap = new Map(products.map((p) => [p.id, p]));

  // Prices are excl VAT, and the rate comes from the product, never from the
  // request -- a client can't talk the server out of charging VAT. The rate is
  // stored on the line so the document always states what it actually charged.
  const quoteItemsData = items.map((item) => {
    const product = productMap.get(item.product_id);
    return {
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: product.unit_price,
      vat_rate: rateForProduct(product),
    };
  });

  const { subtotal_amount, vat_amount, total_amount } = documentTotals(quoteItemsData);

  const { data: quote, error: qErr } = await supabase
    .from('quotes')
    .insert([
      { customer_id: customerId, subtotal_amount, vat_amount, total_amount, status: 'submitted', source },
    ])
    .select()
    .single();

  if (qErr) throw qErr;

  const itemsToInsert = quoteItemsData.map((item) => ({
    ...item,
    quote_id: quote.id,
  }));

  const { error: qiErr } = await supabase.from('quote_items').insert(itemsToInsert);
  if (qiErr) throw qiErr;

  await notifyInternalTeam({
    type: 'quote_submitted',
    title: 'New quote submitted',
    message: `${customerLabel} submitted quote #${quote.quote_number} for ${formatCurrency(total_amount)} via ${source}.`,
    relatedType: 'quote',
    relatedId: quote.id,
  });

  return { quoteId: quote.id, quoteNumber: quote.quote_number, total_amount };
}

// Core logic behind converting a quote to an order, shared the same way.
async function convertQuoteForCustomer(customerId, customerLabel, quoteId, source = 'portal') {
  const { data: quote, error: qErr } = await supabase
    .from('quotes')
    .select('*, quote_items(*)')
    .eq('id', quoteId)
    .eq('customer_id', customerId)
    .single();

  if (qErr || !quote) return { error: 'Quote not found.', status: 404 };
  if (quote.status === 'converted') return { error: 'Quote already converted', status: 400 };
  if (quote.status === 'expired') return { error: 'Quote has expired', status: 400 };

  // Carries the quote's own figures across rather than recalculating: an
  // order must charge what the customer was quoted, even if a product's price
  // or VAT setting has changed since. Legacy quotes have null subtotal/VAT,
  // and the order inherits that, staying VAT-inclusive like its quote.
  const { data: order, error: oErr } = await supabase
    .from('orders')
    .insert([
      {
        quote_id: quote.id,
        customer_id: customerId,
        subtotal_amount: quote.subtotal_amount,
        vat_amount: quote.vat_amount,
        total_amount: quote.total_amount,
        source,
      },
    ])
    .select()
    .single();

  if (oErr) throw oErr;

  const orderItems = quote.quote_items.map((qi) => ({
    order_id: order.id,
    product_id: qi.product_id,
    quantity: qi.quantity,
    unit_price: qi.unit_price,
    vat_rate: qi.vat_rate,
  }));

  const { error: oiErr } = await supabase.from('order_items').insert(orderItems);
  if (oiErr) throw oiErr;

  await supabase.from('quotes').update({ status: 'converted' }).eq('id', quote.id);

  await notifyInternalTeam({
    type: 'quote_converted',
    title: 'Quote converted to order',
    message: `${customerLabel} converted quote #${quote.quote_number} into an order via ${source}, awaiting approval.`,
    relatedType: 'order',
    relatedId: order.id,
  });

  return { orderId: order.id, quoteNumber: quote.quote_number };
}

module.exports = { createQuoteForCustomer, convertQuoteForCustomer };

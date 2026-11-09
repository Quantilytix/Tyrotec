const supabase = require('../config/supabase');
const { invoiceLabel } = require('../utils/invoiceNumber');
const { notifyStockArrivalsSoon } = require('./waitingOrderService');

// Recently deleted (046_recently_deleted.sql). "Delete" moves a quote,
// order/invoice, purchase or customer here for 30 days, where it can be
// restored. After that, quotes and customers with no orders are removed for
// good; orders, invoices and purchases only leave the screens -- the books,
// invoice numbering and SARS record-keeping rely on them.
const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const TYPES = ['quote', 'order', 'purchase', 'customer'];

// What the database functions raise for people, as opposed to bugs.
const READABLE = [
  /^This is already in Recently deleted$/,
  /^This isn't in Recently deleted$/,
  /^A finished sale can't be deleted/,
  /^Only \d+ of the \d+ .+ from this purchase are still in stock/,
  /^This customer still has \d+ order\(s\) or invoice\(s\)\. Delete those first\.$/,
];

function rpcResult(error) {
  if (!error) return null;
  if (/ not found$/.test(error.message || '')) return { error: 'Not found.', status: 404 };
  if (READABLE.some((re) => re.test(error.message || ''))) return { error: error.message, status: 400 };
  throw error;
}

const saleName = (order) =>
  order.invoice_number ? `Invoice ${invoiceLabel(order.invoice_number)}` : `Order #${order.order_number}`;

// How each kind is named, and read for that name.
async function describe(type, id) {
  if (type === 'quote') {
    const { data } = await supabase.from('quotes').select('id, quote_number, status, deleted_at, orders(id)').eq('id', id).maybeSingle();
    return data && { record: data, name: `Quote #${data.quote_number}` };
  }
  if (type === 'order') {
    const { data } = await supabase.from('orders').select('id, order_number, invoice_number, status, deleted_at').eq('id', id).maybeSingle();
    return data && { record: data, name: saleName(data) };
  }
  if (type === 'purchase') {
    const { data } = await supabase.from('purchases').select('id, purchase_number, deleted_at').eq('id', id).maybeSingle();
    return data && { record: data, name: `Purchase #${data.purchase_number}` };
  }
  const { data } = await supabase.from('users').select('id, email, company_name, role, deleted_at').eq('id', id).eq('role', 'customer').maybeSingle();
  return data && { record: data, name: data.company_name || data.email };
}

// Moves it to Recently deleted. Returns { name, cancelled? } or { error, status }.
async function deleteRecord(type, id, userId) {
  if (!TYPES.includes(type)) return { error: 'Unknown kind of record.', status: 400 };
  const found = await describe(type, id);
  if (!found) return { error: 'Not found.', status: 404 };
  const { record, name } = found;

  if (type === 'quote') {
    if (record.deleted_at) return { error: 'This is already in Recently deleted', status: 400 };
    // Embedded one-to-one (orders.quote_id is unique): an object, or an array in older PostgREST.
    const hasOrder = Array.isArray(record.orders) ? record.orders.length > 0 : Boolean(record.orders);
    if (hasOrder) {
      return { error: 'An order or invoice was made from this quote. Delete that instead; the quote goes with it.', status: 400 };
    }
    const { data, error } = await supabase
      .from('quotes')
      .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
      .eq('id', id)
      .is('deleted_at', null)
      .select('id');
    if (error) throw error;
    if (!data?.length) return { error: 'This is already in Recently deleted', status: 400 };
    return { name };
  }

  if (type === 'order') {
    const { data: previousStatus, error } = await supabase.rpc('delete_order', { p_order_id: id, p_deleted_by: userId });
    const failed = rpcResult(error);
    if (failed) return failed;
    const cancelled = previousStatus !== 'cancelled';
    // Cancelling put its stock back, which may go to orders waiting for it.
    if (cancelled) notifyStockArrivalsSoon();
    return { name, cancelled };
  }

  const fn = type === 'purchase' ? 'delete_purchase' : 'delete_customer';
  const args = type === 'purchase' ? { p_purchase_id: id, p_deleted_by: userId } : { p_customer_id: id, p_deleted_by: userId };
  const { error } = await supabase.rpc(fn, args);
  const failed = rpcResult(error);
  if (failed) return failed;
  return { name };
}

// Brings it back. An order or invoice comes back cancelled.
async function restoreRecord(type, id) {
  if (!TYPES.includes(type)) return { error: 'Unknown kind of record.', status: 400 };
  const found = await describe(type, id);
  if (!found) return { error: 'Not found.', status: 404 };

  if (type === 'quote') {
    const { data, error } = await supabase
      .from('quotes')
      .update({ deleted_at: null, deleted_by: null })
      .eq('id', id)
      .not('deleted_at', 'is', null)
      .select('id');
    if (error) throw error;
    if (!data?.length) return { error: "This isn't in Recently deleted", status: 400 };
    return { name: found.name };
  }

  const fn = { order: 'restore_order', purchase: 'restore_purchase', customer: 'restore_customer' }[type];
  const arg = { order: 'p_order_id', purchase: 'p_purchase_id', customer: 'p_customer_id' }[type];
  const { error } = await supabase.rpc(fn, { [arg]: id });
  const failed = rpcResult(error);
  if (failed) return failed;
  // A restored purchase's stock may go to orders waiting for it.
  if (type === 'purchase') notifyStockArrivalsSoon();
  return { name: found.name };
}

// Everything deleted in the last 30 days, newest first, as one list.
async function listRecentlyDeleted(now = Date.now()) {
  const since = new Date(now - RETENTION_MS).toISOString();
  const [quotes, orders, purchases, customers] = await Promise.all([
    supabase.from('quotes').select('id, quote_number, total_amount, deleted_at, deleted_by, users(email, company_name), orders(id)').gte('deleted_at', since),
    supabase.from('orders').select('id, order_number, invoice_number, total_amount, deleted_at, deleted_by, users(email, company_name)').gte('deleted_at', since),
    supabase.from('purchases').select('id, purchase_number, supplier_invoice_number, total_amount, deleted_at, deleted_by, supplier:suppliers(name)').gte('deleted_at', since),
    supabase.from('users').select('id, email, company_name, deleted_at, deleted_by').eq('role', 'customer').gte('deleted_at', since),
  ]);
  for (const result of [quotes, orders, purchases, customers]) if (result.error) throw result.error;

  const customerName = (row) => row.users?.company_name || row.users?.email || '';
  const items = [
    // A quote an order was made from went with that order: listed as the order.
    ...quotes.data
      .filter((q) => !(Array.isArray(q.orders) ? q.orders.length : q.orders))
      .map((q) => ({ type: 'quote', id: q.id, name: `Quote #${q.quote_number}`, party: customerName(q), amount: q.total_amount, kept: false, ...q })),
    ...orders.data.map((o) => ({ type: 'order', id: o.id, name: saleName(o), party: customerName(o), amount: o.total_amount, kept: true, ...o })),
    ...purchases.data.map((p) => ({
      type: 'purchase', id: p.id, name: `Purchase #${p.purchase_number}`, party: p.supplier?.name || '', amount: p.total_amount, kept: true, ...p,
    })),
    ...customers.data.map((c) => ({ type: 'customer', id: c.id, name: c.company_name || c.email, party: c.email, amount: null, kept: false, ...c })),
  ];

  // Who deleted each, by name.
  const staffIds = [...new Set(items.map((i) => i.deleted_by).filter(Boolean))];
  const { data: staff } = staffIds.length
    ? await supabase.from('users').select('id, full_name, company_name, email').in('id', staffIds)
    : { data: [] };
  const staffName = new Map((staff || []).map((s) => [s.id, s.full_name || s.company_name || s.email]));

  return items
    .map((i) => ({
      type: i.type,
      id: i.id,
      name: i.name,
      party: i.party,
      amount: i.amount,
      deleted_at: i.deleted_at,
      deleted_by: staffName.get(i.deleted_by) || null,
      // When it leaves this list: for good, or (kept) only from the screens.
      leaves_at: new Date(new Date(i.deleted_at).getTime() + RETENTION_MS).toISOString(),
      kept: i.kept,
    }))
    .sort((a, b) => new Date(b.deleted_at) - new Date(a.deleted_at));
}

// After 30 days: deleted quotes go for good (in the database function), and
// so do deleted customers with no orders -- by removing their sign-in, which
// takes their profile with it. Returns how many customers were removed.
async function purgeRecentlyDeleted() {
  const { data, error } = await supabase.rpc('purge_recently_deleted');
  if (error) throw error;
  let removed = 0;
  for (const row of data || []) {
    const { error: authError } = await supabase.auth.admin.deleteUser(row.purged_customer_id);
    if (authError) {
      console.error(`Could not remove deleted customer ${row.purged_customer_id}:`, authError.message);
    } else {
      removed += 1;
    }
  }
  return removed;
}

module.exports = { RETENTION_DAYS, TYPES, deleteRecord, restoreRecord, listRecentlyDeleted, purgeRecentlyDeleted };

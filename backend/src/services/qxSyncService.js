// Sends queued changes to QX (033_qx_sync_outbox.sql explains the queue).
//
// Each run takes the oldest due entries, rebuilds every record from its
// current data (qxRecords.js), posts them to QX in one request and records
// what QX said: accepted records are done; rejected ones (usually something
// they depend on hasn't arrived yet) are retried later with a growing delay.
// If QX can't be reached the whole batch is retried.
//
// Two switches:
//  - QX_CONNECT_URL + QX_CONNECT_KEY: the connection itself. Enough for staff
//    to sign in from QX (qxSsoController.js).
//  - QX_SYNC_ENABLED=true: also send data. Off unless set, so the connection
//    can be used for sign-in before anything is sent. Changes keep queuing
//    while it's off.

const supabase = require('../config/supabase');
const records = require('./qxRecords');

const BATCH_SIZE = 200; // QX's per-request limit
// Ids per database read: 200 ids in one filter makes a URL long enough for
// the Supabase gateway to refuse.
const READ_CHUNK = 50;
const REQUEST_TIMEOUT_MS = 60 * 1000;
// A change is sent this soon after it's made (scheduleQxSyncSoon); the
// 5-minute job remains the safety net, and runs the retries.
const SOON_DELAY_MS = 15 * 1000;
const DONE_OUTCOMES = new Set(['applied', 'unchanged', 'stale', 'flagged']);

function qxConfig() {
  const url = (process.env.QX_CONNECT_URL || '').replace(/\/+$/, '');
  const key = process.env.QX_CONNECT_KEY || '';
  return url && key ? { url, key } : null;
}

function syncEnabled() {
  return String(process.env.QX_SYNC_ENABLED || '').trim().toLowerCase() === 'true';
}

// What each queue entry type loads, and how it becomes a QX record.
const LOADERS = {
  customer: {
    select: 'id, email, company_name, full_name, phone, address, vat_number, role',
    table: 'users',
    build: (row) => (row.role === 'customer' ? records.customerRecord(row) : null),
  },
  supplier: { table: 'suppliers', select: '*', build: (row) => records.supplierRecord(row) },
  product: { table: 'products', select: '*', build: (row) => records.productRecord(row) },
  quote: {
    table: 'quotes',
    select: '*, quote_items(product_id, quantity, unit_price, vat_rate, product:products(sku, name))',
    build: (row) => records.quoteRecord(row),
  },
  order: {
    table: 'orders',
    select: '*, order_items(product_id, quantity, unit_price, vat_rate, product:products(sku, name))',
    build: (row) => records.orderRecord(row),
  },
  payment: { table: 'payments', select: '*', build: (row) => records.paymentRecord(row) },
  purchase: {
    table: 'purchases',
    select: '*, purchase_items(product_id, quantity, unit_cost, vat_rate)',
    build: (row) => records.purchaseRecord(row),
  },
  stock_adjustment: { table: 'stock_adjustments', select: '*', build: (row) => records.stockAdjustmentRecord(row) },
  opening_stock: { table: 'opening_stock', select: '*', build: (row) => records.openingStockRecord(row) },
};

// Queue entries -> QX records, read now. A record that no longer exists is
// sent as deleted. updated_at is the read time: later reads of the same
// record always carry a later time, so QX never applies an older version.
async function buildRecords(entries) {
  const readAt = new Date().toISOString();
  const byType = new Map();
  for (const entry of entries) {
    if (!byType.has(entry.entity_type)) byType.set(entry.entity_type, []);
    byType.get(entry.entity_type).push(entry);
  }

  const built = [];
  for (const [type, group] of byType) {
    const loader = LOADERS[type];
    const rowsById = new Map();
    for (let i = 0; i < group.length; i += READ_CHUNK) {
      const { data, error } = await supabase
        .from(loader.table)
        .select(loader.select)
        .in('id', group.slice(i, i + READ_CHUNK).map((e) => e.entity_id));
      if (error) throw error;
      for (const row of data || []) rowsById.set(row.id, row);
    }

    for (const entry of group) {
      const row = rowsById.get(entry.entity_id);
      const data = row ? loader.build(row) : null;
      built.push({
        entry,
        record: data
          ? { type, id: entry.entity_id, updated_at: readAt, data }
          : { type, id: entry.entity_id, updated_at: readAt, deleted: true },
      });
    }
  }
  return built;
}

async function postRecords(config, recordList, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${config.url}/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': config.key },
      body: JSON.stringify({ records: recordList }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`QX answered ${response.status}: ${body?.error || 'no details'}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function completeEntries(results) {
  if (!results.length) return;
  const { error } = await supabase.rpc('qx_outbox_complete', { p_results: results });
  if (error) throw error;
}

// One batch. Returns { sent, done, failed } or null when nothing is due.
async function syncBatch(config, { fetchImpl = fetch, batchSize = BATCH_SIZE } = {}) {
  const { data: entries, error } = await supabase
    .from('qx_sync_outbox')
    .select('id, entity_type, entity_id, enqueued_at, attempts')
    .is('sent_at', null)
    .lte('next_attempt_at', new Date().toISOString())
    .order('id', { ascending: true })
    .limit(batchSize);
  if (error) throw error;
  if (!entries || entries.length === 0) return null;

  let built;
  let response;
  try {
    built = await buildRecords(entries);
    response = await postRecords(config, built.map((b) => b.record), fetchImpl);
  } catch (err) {
    const message = err.name === 'AbortError' ? 'QX did not answer in time' : err.message;
    await completeEntries(entries.map((e) => ({ id: e.id, enqueued_at: e.enqueued_at, ok: false, error: message })));
    return { sent: entries.length, done: 0, failed: entries.length, error: message };
  }

  const outcomeByKey = new Map((response?.results || []).map((r) => [`${r.type}:${r.id}`, r]));
  const results = built.map(({ entry, record }) => {
    const result = outcomeByKey.get(`${record.type}:${record.id}`);
    const ok = !!result && DONE_OUTCOMES.has(result.outcome);
    return {
      id: entry.id,
      enqueued_at: entry.enqueued_at,
      ok,
      error: ok ? null : result?.message || 'QX did not return a result for this record',
    };
  });
  await completeEntries(results);
  const done = results.filter((r) => r.ok).length;
  return { sent: results.length, done, failed: results.length - done };
}

// Drains what's due, a batch at a time, stopping after maxBatches so one run
// can't hog the process (a big backfill just continues on the next run).
// One run at a time in this process: a call while one is going gets its result.
let inFlight = null;
function runQxSync(options = {}) {
  if (!inFlight) inFlight = drain(options).finally(() => { inFlight = null; });
  return inFlight;
}

async function drain({ maxBatches = 10, fetchImpl = fetch, log = console } = {}) {
  const config = qxConfig();
  if (!config) return { skipped: true, reason: 'not_connected' };
  if (!syncEnabled()) return { skipped: true, reason: 'sync_disabled' };

  const totals = { batches: 0, sent: 0, done: 0, failed: 0 };
  for (let i = 0; i < maxBatches; i++) {
    const batch = await syncBatch(config, { fetchImpl });
    if (!batch) break;
    totals.batches++;
    totals.sent += batch.sent;
    totals.done += batch.done;
    totals.failed += batch.failed;
    if (batch.error) {
      log.error(`QX sync: ${batch.error}; ${batch.sent} change(s) will be retried.`);
      break;
    }
    if (batch.done === 0) break; // nothing moving; wait for the retry delay
  }
  if (totals.sent > 0) {
    log.log(`QX sync: sent ${totals.sent} change(s), ${totals.done} accepted, ${totals.failed} to retry.`);
  }
  return totals;
}

// Sends changes shortly after they're made, so QX is up to date within
// seconds rather than at the next 5-minute run. The first change starts the
// timer; changes made before it fires go in the same run.
let soonTimer = null;
function scheduleQxSyncSoon(delayMs = SOON_DELAY_MS) {
  if (soonTimer || !qxConfig() || !syncEnabled()) return;
  soonTimer = setTimeout(() => {
    soonTimer = null;
    runQxSync().catch((err) => console.error('QX sync failed:', err.message || err));
  }, delayMs);
  if (soonTimer.unref) soonTimer.unref();
}

// Express middleware: any request that changed something successfully
// schedules a sync. Changes only happen through this API (the website,
// PayFast's notifications, WhatsApp), so this covers all of them.
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
function syncSoonAfterChanges(req, res, next) {
  if (MUTATING.has(req.method)) {
    res.on('finish', () => {
      if (res.statusCode < 400) scheduleQxSyncSoon();
    });
  }
  next();
}

module.exports = {
  qxConfig, syncEnabled, buildRecords, postRecords, syncBatch, runQxSync, scheduleQxSyncSoon, syncSoonAfterChanges,
  LOADERS, DONE_OUTCOMES,
};

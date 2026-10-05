jest.mock('../../config/supabase', () => ({ from: jest.fn(), rpc: jest.fn() }));

const supabase = require('../../config/supabase');
const records = require('../qxRecords');
const { runQxSync, buildRecords, scheduleQxSyncSoon, syncSoonAfterChanges } = require('../qxSyncService');

// A chainable, awaitable stand-in for one supabase.from(...) query.
function query(result) {
  const q = {};
  for (const m of ['select', 'is', 'lte', 'order', 'limit', 'in', 'eq']) q[m] = jest.fn(() => q);
  q.then = (ok, err) => Promise.resolve(result).then(ok, err);
  return q;
}

describe('qxRecords', () => {
  it('localDate uses the South African calendar day', () => {
    expect(records.localDate('2026-10-01T22:30:00Z')).toBe('2026-10-02');
    expect(records.localDate('2026-10-01T21:59:00Z')).toBe('2026-10-01');
  });

  it('customer: company name first, the person as contact', () => {
    expect(records.customerRecord({ email: 'a@b.co', company_name: 'Sibanye', full_name: 'Thandi', phone: '011', address: null, vat_number: '41' }))
      .toEqual({ name: 'Sibanye', contact_person: 'Thandi', email: 'a@b.co', phone: '011', address: null, vat_number: '41' });
    expect(records.customerRecord({ email: 'a@b.co', full_name: 'Thandi' }).name).toBe('Thandi');
    expect(records.customerRecord({ email: 'a@b.co' }).name).toBe('a@b.co');
  });

  it('product: VAT flag, average cost, always stock (Tyrotec sells no services)', () => {
    const product = { sku: 'HV', name: 'Valve', category: 'Rebuilds', unit_price: '1000', vat_applicable: true, supplier_cost: '613.33', stock_quantity: 28 };
    expect(records.productRecord(product)).toMatchObject({ unit_price: 1000, vat_rate: 15, cost_price: 613.33, stock_quantity: 28, is_service: false });
    expect(records.productRecord({ ...product, vat_applicable: false, supplier_cost: null }))
      .toMatchObject({ vat_rate: 0, cost_price: null, is_service: false });
  });

  it('quote: VAT-exclusive normally, legacy documents include VAT', () => {
    const quote = {
      quote_number: 1001, created_at: '2026-10-01T08:00:00Z', status: 'submitted', customer_id: 'c1',
      subtotal_amount: '11600', total_amount: '13340',
      quote_items: [{ product_id: 'p1', quantity: 10, unit_price: '1000', vat_rate: '15', product: { sku: 'HV', name: 'Valve' } }],
    };
    expect(records.quoteRecord(quote)).toEqual({
      number: 1001, date: '2026-10-01', status: 'submitted', customer_id: 'c1', prices_include_vat: false, total: 13340,
      lines: [{ product_id: 'p1', name: 'Valve', description: 'HV – Valve', quantity: 10, unit_price: 1000, vat_rate: 15 }],
    });
    const legacy = records.quoteRecord({ ...quote, subtotal_amount: null, quote_items: [{ ...quote.quote_items[0], vat_rate: null }] });
    expect(legacy.prices_include_vat).toBe(true);
    expect(legacy.lines[0].vat_rate).toBe(15);
  });

  it('order: dated the day it became a sale, else the day it was placed', () => {
    const order = { order_number: 7, quote_id: 'q', customer_id: 'c', status: 'approved', subtotal_amount: 10, total_amount: 11.5,
      created_at: '2026-10-28T08:00:00Z', committed_at: '2026-11-03T09:00:00Z', order_items: [] };
    expect(records.orderRecord(order).date).toBe('2026-11-03');
    expect(records.orderRecord({ ...order, committed_at: null }).date).toBe('2026-10-28');
  });

  it('payment: verified date first', () => {
    expect(records.paymentRecord({ order_id: 'o', amount: '5', method: 'payfast', gateway: 'payfast', reference: 'PF', status: 'approved',
      verified_at: '2026-10-03T23:00:00Z', created_at: '2026-10-01T10:00:00Z' }).date).toBe('2026-10-04');
  });
});

describe('runQxSync', () => {
  const OLD_ENV = process.env;
  const ENTRIES = [
    { id: 1, entity_type: 'customer', entity_id: 'c1', enqueued_at: '2026-10-04T10:00:00.123456+00:00', attempts: 0 },
    { id: 2, entity_type: 'order', entity_id: 'o1', enqueued_at: '2026-10-04T10:00:01+00:00', attempts: 0 },
    { id: 3, entity_type: 'product', entity_id: 'gone', enqueued_at: '2026-10-04T10:00:02+00:00', attempts: 0 },
  ];

  function wireSupabase({ entries = ENTRIES } = {}) {
    let outboxReads = 0;
    supabase.from.mockImplementation((table) => {
      if (table === 'qx_sync_outbox') return query({ data: outboxReads++ === 0 ? entries : [], error: null });
      if (table === 'users') return query({ data: [{ id: 'c1', email: 'a@b.co', company_name: 'Sib', role: 'customer' }], error: null });
      if (table === 'orders') return query({ data: [{ id: 'o1', order_number: 7, created_at: '2026-10-02T08:00:00Z', status: 'approved', subtotal_amount: 10, total_amount: 11.5, order_items: [] }], error: null });
      if (table === 'products') return query({ data: [], error: null });
      throw new Error(`unexpected table ${table}`);
    });
    supabase.rpc.mockResolvedValue({ data: null, error: null });
  }

  beforeEach(() => {
    jest.resetAllMocks();
    process.env = { ...OLD_ENV, QX_CONNECT_URL: 'https://qx.example/api/connect/v1/', QX_CONNECT_KEY: 'qx_live_k', QX_SYNC_ENABLED: 'true' };
  });
  afterAll(() => { process.env = OLD_ENV; });

  it('is off without settings', async () => {
    delete process.env.QX_CONNECT_KEY;
    expect(await runQxSync()).toEqual({ skipped: true, reason: 'not_connected' });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 'false', 'yes', '1'])('sends nothing unless QX_SYNC_ENABLED is "true" (%p)', async (value) => {
    if (value === undefined) delete process.env.QX_SYNC_ENABLED; else process.env.QX_SYNC_ENABLED = value;
    const fetchImpl = jest.fn();
    expect(await runQxSync({ fetchImpl })).toEqual({ skipped: true, reason: 'sync_disabled' });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('accepts "TRUE" / " true " as on', async () => {
    process.env.QX_SYNC_ENABLED = ' TRUE ';
    wireSupabase({ entries: [] });
    expect(await runQxSync()).toEqual({ batches: 0, sent: 0, done: 0, failed: 0 });
  });

  it('sends one batch, marks accepted ones done and retries the rest', async () => {
    wireSupabase();
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [
        { type: 'customer', id: 'c1', outcome: 'applied' },
        { type: 'order', id: 'o1', outcome: 'error', message: 'Customer o hasn\'t synced' },
        { type: 'product', id: 'gone', outcome: 'flagged' },
      ] }),
    });
    const log = { log: jest.fn(), error: jest.fn() };

    const totals = await runQxSync({ fetchImpl, log });
    expect(totals).toEqual({ batches: 1, sent: 3, done: 2, failed: 1 });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://qx.example/api/connect/v1/records');
    expect(init.headers['X-API-Key']).toBe('qx_live_k');
    const sent = JSON.parse(init.body).records;
    expect(sent.find((r) => r.id === 'c1')).toMatchObject({ type: 'customer', data: { name: 'Sib' } });
    expect(sent.find((r) => r.id === 'gone')).toMatchObject({ type: 'product', deleted: true });
    expect(sent.find((r) => r.id === 'gone').data).toBeUndefined();

    // Accepted (applied/flagged) -> done; error -> retried with QX's reason.
    // The original enqueued_at goes back so a record changed meanwhile stays queued.
    expect(supabase.rpc).toHaveBeenCalledWith('qx_outbox_complete', { p_results: [
      { id: 1, enqueued_at: ENTRIES[0].enqueued_at, ok: true, error: null },
      { id: 2, enqueued_at: ENTRIES[1].enqueued_at, ok: false, error: 'Customer o hasn\'t synced' },
      { id: 3, enqueued_at: ENTRIES[2].enqueued_at, ok: true, error: null },
    ] });
  });

  it('when QX is down, the whole batch is retried and the run stops', async () => {
    wireSupabase();
    const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const log = { log: jest.fn(), error: jest.fn() };
    const totals = await runQxSync({ fetchImpl, log });
    expect(totals).toMatchObject({ sent: 3, done: 0, failed: 3 });
    const results = supabase.rpc.mock.calls[0][1].p_results;
    expect(results.every((r) => !r.ok && r.error === 'ECONNREFUSED')).toBe(true);
    expect(log.error).toHaveBeenCalled();
  });

  it('a non-200 from QX is a batch failure with QX\'s reason', async () => {
    wireSupabase();
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'This connection is disabled.' }) });
    await runQxSync({ fetchImpl, log: { log: jest.fn(), error: jest.fn() } });
    expect(supabase.rpc.mock.calls[0][1].p_results[0].error).toBe('QX answered 403: This connection is disabled.');
  });

  it('reads queued records 50 ids at a time (a long id list makes the URL too long)', async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const reads = [];
    supabase.from.mockImplementation(() => {
      const q = query(null);
      q.in = jest.fn((_col, list) => { reads.push(list.length); q.then = (ok) => Promise.resolve({ data: list.map((id) => ({ id, name: 'S' })), error: null }).then(ok); return q; });
      return q;
    });
    const built = await buildRecords(ids.map((id, n) => ({ id: n, entity_type: 'supplier', entity_id: id, enqueued_at: 'x' })));
    expect(reads).toEqual([50, 50, 20]);
    expect(built).toHaveLength(120);
    expect(built.every((b) => !b.record.deleted)).toBe(true);
  });

  it('runs once at a time: a call during a run gets the same result', async () => {
    wireSupabase({ entries: [] });
    const [a, b] = await Promise.all([runQxSync(), runQxSync()]);
    expect(a).toBe(b);
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it('staff users queued as customers are sent as deleted, never as customers', async () => {
    supabase.from.mockImplementation((table) => {
      return query({ data: [{ id: 'u1', email: 's@t.co', role: 'admin' }], error: null });
    });
    const built = await buildRecords([{ id: 9, entity_type: 'customer', entity_id: 'u1', enqueued_at: 'x' }]);
    expect(built[0].record).toMatchObject({ type: 'customer', id: 'u1', deleted: true });
  });
});

describe('sync soon after a change', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetAllMocks();
    process.env = { ...OLD_ENV, QX_CONNECT_URL: 'https://qx.example/api/connect/v1', QX_CONNECT_KEY: 'qx_live_k', QX_SYNC_ENABLED: 'true' };
    supabase.from.mockImplementation(() => query({ data: [], error: null }));
  });
  afterEach(() => { jest.runOnlyPendingTimers(); jest.useRealTimers(); });
  afterAll(() => { process.env = OLD_ENV; });

  function request(method, statusCode) {
    const listeners = {};
    const res = { statusCode, on: (event, fn) => { listeners[event] = fn; } };
    syncSoonAfterChanges({ method }, res, () => {});
    if (listeners.finish) listeners.finish();
  }

  it('a successful change schedules one run 15 seconds later; more changes ride along', async () => {
    request('POST', 201);
    request('PATCH', 200);
    expect(supabase.from).not.toHaveBeenCalled();
    jest.advanceTimersByTime(15000);
    await Promise.resolve();
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it('reads and failed requests schedule nothing', () => {
    request('GET', 200);
    request('POST', 400);
    jest.advanceTimersByTime(60000);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('schedules nothing while sending data is switched off', () => {
    process.env.QX_SYNC_ENABLED = 'false';
    request('POST', 201);
    jest.advanceTimersByTime(60000);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('does nothing while QX is not set up', () => {
    delete process.env.QX_CONNECT_URL;
    scheduleQxSyncSoon(10);
    jest.advanceTimersByTime(1000);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});

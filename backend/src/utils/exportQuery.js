// Shared plumbing for the admin Excel exports: turning the From/To date
// pickers into timestamps, and reading every matching row rather than the
// first page.

// Tyrotec is a South African business, and the date pickers show plain
// calendar dates. Anchoring them to SAST (UTC+2) means "To: 31 August" covers
// everything up to midnight in Johannesburg -- with a naive UTC range, orders
// placed after 02:00 SAST on the 1st would land in August's export.
const SAST_OFFSET = '+02:00';
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function rangeStart(from) {
  return DATE_ONLY.test(String(from || '')) ? `${from}T00:00:00.000${SAST_OFFSET}` : null;
}

function rangeEnd(to) {
  return DATE_ONLY.test(String(to || '')) ? `${to}T23:59:59.999${SAST_OFFSET}` : null;
}

// Applies an optional created_at range to a PostgREST query builder.
function applyDateRange(query, { from, to } = {}) {
  const start = rangeStart(from);
  const end = rangeEnd(to);
  if (start) query = query.gte('created_at', start);
  if (end) query = query.lte('created_at', end);
  return query;
}

// PostgREST caps a single response (1000 rows by default), which would
// silently truncate an export of a busy month. Page through instead.
// buildQuery() must return a fresh query each call -- a Supabase query builder
// can only be awaited once.
const PAGE_SIZE = 1000;
const MAX_PAGES = 50; // 50k rows: far past any sane export, but not unbounded

async function fetchAllRows(buildQuery) {
  const rows = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;

    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }

  return rows;
}

module.exports = { rangeStart, rangeEnd, applyDateRange, fetchAllRows, PAGE_SIZE };

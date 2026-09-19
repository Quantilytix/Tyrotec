// Free-text search for the admin quote and order exports.
//
// Mirrors frontend/src/utils/searchFilter.js: the admin tables filter what's
// on screen with the same rules, and an export run with a search term has to
// contain exactly those rows.
//
// Applied in JS over the already-fetched rows rather than as a database
// filter, because the fields searched span the joined customer record
// (users.company_name / users.email), which PostgREST can't filter on in a
// single `or` with the parent table's own columns.

function matchesSearch(term, parts) {
  const query = String(term || '').trim().toLowerCase();
  if (!query) return true;

  const haystack = parts.filter(Boolean).join(' ').toLowerCase();
  return query.split(/\s+/).every((word) => haystack.includes(word.replace(/^#/, '')));
}

// Number and customer: what staff have in front of them when they search.
function recordSearchParts(record, numberField) {
  return [String(record[numberField] ?? ''), record.users?.company_name, record.users?.email];
}

function filterBySearch(records, term, numberField) {
  if (!String(term || '').trim()) return records;
  return records.filter((record) => matchesSearch(term, recordSearchParts(record, numberField)));
}

module.exports = { matchesSearch, recordSearchParts, filterBySearch };

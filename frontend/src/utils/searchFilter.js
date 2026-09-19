// Free-text search for the admin quote and order tables.
//
// Mirrored server-side (backend/src/utils/searchFilter.js) so an export run
// with a search term contains exactly the rows the table is showing.

// Each term must appear somewhere in the record, so "buyer co 52" narrows
// rather than widening the way a plain OR would. A leading # is dropped so
// searching "#52" finds order 52.
export function matchesSearch(term, parts) {
  const query = String(term || '').trim().toLowerCase();
  if (!query) return true;

  const haystack = parts.filter(Boolean).join(' ').toLowerCase();
  return query
    .split(/\s+/)
    .every((word) => haystack.includes(word.replace(/^#/, '')));
}

// What a search covers for a quote or an order: its number, and who it
// belongs to. Staff search by the number on a document or by the customer in
// front of them.
export function recordSearchParts(record, numberField) {
  return [
    String(record[numberField] ?? ''),
    record.users?.company_name,
    record.users?.email,
  ];
}

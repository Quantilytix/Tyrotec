// Which page numbers a pager shows: the first and last page, the current one
// and its neighbours, with '…' for the gaps. 39 pages on page 5:
// [1, '…', 4, 5, 6, '…', 39]. Few enough pages are all shown.
export function pageItems(current, total, neighbours = 1) {
  if (total <= 1) return [1];
  if (total <= 5 + neighbours * 2) return Array.from({ length: total }, (_, i) => i + 1);

  const from = Math.max(2, current - neighbours);
  const to = Math.min(total - 1, current + neighbours);
  const items = [1];
  if (from > 2) items.push('…');
  for (let p = from; p <= to; p++) items.push(p);
  if (to < total - 1) items.push('…');
  items.push(total);
  return items;
}

// A typed page number, kept within 1..total, or null when it isn't a number.
export function clampPage(value, total) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(n, 1), Math.max(total, 1));
}

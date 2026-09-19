// Date-range filtering for the admin list screens, kept in step with the
// server-side export filter (backend/src/utils/exportQuery.js).
//
// Both ends are inclusive whole days, compared in the viewer's own timezone:
// picking "To: 31 August" must include an order placed at 16:00 on the 31st
// in Johannesburg, which is what someone reading the screen expects.

// 'en-CA' formats as YYYY-MM-DD, which sorts and compares as plain text --
// and, unlike toISOString(), it uses local time rather than UTC.
export function toLocalDateString(isoString) {
  return new Date(isoString).toLocaleDateString('en-CA');
}

// Ready-made ranges for the export modal, so the common cases ("last month"
// for accounting) are one click rather than two date pickers. Computed in
// local time for the same reason as above, and returned in the YYYY-MM-DD
// shape the date inputs and the API both expect.
export const EXPORT_PRESETS = [
  { key: 'all', label: 'All time' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'last_30_days', label: 'Last 30 days' },
  { key: 'this_year', label: 'This year' },
  { key: 'custom', label: 'Custom range' },
];

export function presetRange(key, today = new Date()) {
  const year = today.getFullYear();
  const month = today.getMonth();
  const startOfToday = new Date(year, month, today.getDate());
  const asDate = (date) => date.toLocaleDateString('en-CA');

  switch (key) {
    case 'this_month':
      return { from: asDate(new Date(year, month, 1)), to: asDate(startOfToday) };
    case 'last_month':
      // Day 0 of this month is the last day of the previous one.
      return { from: asDate(new Date(year, month - 1, 1)), to: asDate(new Date(year, month, 0)) };
    case 'last_30_days':
      return { from: asDate(new Date(year, month, today.getDate() - 29)), to: asDate(startOfToday) };
    case 'this_year':
      return { from: asDate(new Date(year, 0, 1)), to: asDate(startOfToday) };
    default: // 'all' and 'custom' start with no range
      return { from: '', to: '' };
  }
}

export function isWithinDateRange(isoString, from, to) {
  if (!from && !to) return true;
  if (!isoString) return false;

  const day = toLocalDateString(isoString);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

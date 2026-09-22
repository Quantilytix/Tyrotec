import { statusLabel } from '../../utils/statusLabels';

// Search + source + status filters for the admin Quotes and Orders tables.
//
// Deliberately a row of its own above the table rather than more controls in
// the page header: the header is for actions (Export, New quote), and filters
// there crowded it out as soon as there was more than one.

const CONTROL =
  'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-teal-500';

export default function ListFilters({
  search,
  onSearchChange,
  source,
  onSourceChange,
  status,
  onStatusChange,
  statuses,
  shown,
  total,
  noun,
}) {
  const filtering = Boolean(search) || source !== 'all' || status !== 'all';

  return (
    <div className="mt-6 flex flex-wrap items-center gap-3">
      <input
        type="search"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={`Search by number, customer or email`}
        className={`${CONTROL} min-w-[16rem] flex-1`}
      />

      <select value={source} onChange={(e) => onSourceChange(e.target.value)} className={CONTROL}>
        <option value="all">All sources</option>
        <option value="portal">Portal</option>
        <option value="whatsapp">WhatsApp</option>
        <option value="admin">Staff</option>
      </select>

      <select value={status} onChange={(e) => onStatusChange(e.target.value)} className={`${CONTROL} capitalize`}>
        <option value="all">All statuses</option>
        {statuses.map((entry) => {
          // Quotes pass plain stored statuses; orders pass grouped ones,
          // where several stored statuses share a single option.
          const value = typeof entry === 'string' ? entry : entry.value;
          const label = typeof entry === 'string' ? statusLabel(entry) : entry.label;
          return (
            <option key={value} value={value}>
              {label}
            </option>
          );
        })}
      </select>

      {filtering && (
        <>
          <span className="text-sm text-slate-500">
            {shown} of {total} {noun}
          </span>
          <button
            type="button"
            onClick={() => {
              onSearchChange('');
              onSourceChange('all');
              onStatusChange('all');
            }}
            className="text-xs font-medium text-teal-600 transition-colors duration-150 hover:underline"
          >
            Clear filters
          </button>
        </>
      )}
    </div>
  );
}

import { useState } from 'react';
import Button from '../ui/Button';
import { EXPORT_PRESETS, presetRange } from '../../utils/dateRange';

// Body of the "Export to Excel" modal on the admin Quotes and Orders screens.
//
// The date range lives here rather than in the page header: the header is
// shared with the filters and the other actions, and two date inputs crowded
// out everything else. It also means the range is chosen deliberately, at the
// moment of exporting, instead of quietly staying set from an earlier export.
//
// `countFor(from, to)` reports how many records the chosen range covers, so
// nobody downloads an empty file and wonders why.

const FIELD =
  'mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-teal-500';
const LABEL = 'block text-xs font-medium text-slate-600';

export default function ExportModal({ noun, filterSummary, countFor, onExport, onClose }) {
  const [preset, setPreset] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const choosePreset = (key) => {
    setPreset(key);
    const range = presetRange(key);
    // 'custom' keeps whatever is already typed instead of clearing it.
    if (key !== 'custom') {
      setFrom(range.from);
      setTo(range.to);
    }
  };

  const count = countFor ? countFor(from, to) : null;

  const handleExport = async () => {
    setError('');
    setExporting(true);
    try {
      await onExport({ from, to });
      onClose();
    } catch (err) {
      setError(err.message || `Could not export the ${noun}.`);
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className={LABEL} htmlFor="export-preset">
          Period
        </label>
        <select
          id="export-preset"
          value={preset}
          onChange={(e) => choosePreset(e.target.value)}
          className={FIELD}
        >
          {EXPORT_PRESETS.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {preset !== 'all' && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={LABEL} htmlFor="export-from">
              From
            </label>
            <input
              id="export-from"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => {
                setPreset('custom');
                setFrom(e.target.value);
              }}
              className={FIELD}
            />
          </div>
          <div>
            <label className={LABEL} htmlFor="export-to">
              To
            </label>
            <input
              id="export-to"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => {
                setPreset('custom');
                setTo(e.target.value);
              }}
              className={FIELD}
            />
          </div>
        </div>
      )}

      <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
        <p>
          {count === null ? (
            <>Exports all {noun} in the selected period.</>
          ) : (
            <>
              <span className="font-medium text-ink">
                {count} {count === 1 ? noun.replace(/s$/, '') : noun}
              </span>{' '}
              will be exported
              {from || to ? ' for this period' : ' (all time)'}.
            </>
          )}
        </p>
        {filterSummary && <p className="mt-0.5 text-xs text-slate-500">{filterSummary}</p>}
        <p className="mt-0.5 text-xs text-slate-500">
          Excel file with a summary sheet and a line-item sheet.
        </p>
      </div>

      {error && <p className="rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-500">{error}</p>}

      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose} disabled={exporting}>
          Cancel
        </Button>
        <Button onClick={handleExport} loading={exporting} disabled={count === 0}>
          Export
        </Button>
      </div>
    </div>
  );
}

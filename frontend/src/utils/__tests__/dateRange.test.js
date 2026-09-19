import { describe, it, expect } from 'vitest';
import { isWithinDateRange, toLocalDateString, presetRange, EXPORT_PRESETS } from '../dateRange';

// Built from a local Date so the expectations hold whatever timezone the test
// machine runs in -- the filter deliberately works in the viewer's own time.
const localIso = (year, month, day, hour = 12) => new Date(year, month - 1, day, hour).toISOString();

describe('isWithinDateRange', () => {
  const aug15 = localIso(2026, 8, 15);

  it('keeps everything when no dates are set', () => {
    expect(isWithinDateRange(aug15, '', '')).toBe(true);
  });

  it('includes both ends of the range', () => {
    expect(isWithinDateRange(aug15, '2026-08-15', '2026-08-15')).toBe(true);
  });

  // The end of the last day counts: an order at 23:00 on the To date is in.
  it('includes late-evening records on the To date', () => {
    expect(isWithinDateRange(localIso(2026, 8, 31, 23), '2026-08-01', '2026-08-31')).toBe(true);
  });

  it('excludes records outside the range', () => {
    expect(isWithinDateRange(aug15, '2026-08-16', '')).toBe(false);
    expect(isWithinDateRange(aug15, '', '2026-08-14')).toBe(false);
  });

  it('works with only one end set', () => {
    expect(isWithinDateRange(aug15, '2026-08-01', '')).toBe(true);
    expect(isWithinDateRange(aug15, '', '2026-08-31')).toBe(true);
  });

  it('treats a missing date as outside a set range', () => {
    expect(isWithinDateRange(null, '2026-08-01', '2026-08-31')).toBe(false);
  });
});

describe('presetRange', () => {
  // A mid-month date in a leap year, to catch month-length mistakes.
  const today = new Date(2026, 2, 14); // 14 March 2026, local time

  it('covers this month from the 1st to today', () => {
    expect(presetRange('this_month', today)).toEqual({ from: '2026-03-01', to: '2026-03-14' });
  });

  it('covers the whole of last month, ending on its real last day', () => {
    expect(presetRange('last_month', today)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    // December -> the previous year, not month -1 of the same one.
    expect(presetRange('last_month', new Date(2026, 0, 10))).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('counts 30 days inclusive of today', () => {
    expect(presetRange('last_30_days', today)).toEqual({ from: '2026-02-13', to: '2026-03-14' });
  });

  it('covers this year from 1 January', () => {
    expect(presetRange('this_year', today)).toEqual({ from: '2026-01-01', to: '2026-03-14' });
  });

  it('leaves the range empty for all-time and custom', () => {
    expect(presetRange('all', today)).toEqual({ from: '', to: '' });
    expect(presetRange('custom', today)).toEqual({ from: '', to: '' });
  });

  it('offers a preset for every option the modal lists', () => {
    for (const { key } of EXPORT_PRESETS) {
      expect(presetRange(key, today)).toMatchObject({ from: expect.any(String), to: expect.any(String) });
    }
  });
});

describe('toLocalDateString', () => {
  it('formats as YYYY-MM-DD in local time, so plain text comparison sorts correctly', () => {
    expect(toLocalDateString(localIso(2026, 8, 5))).toBe('2026-08-05');
  });
});

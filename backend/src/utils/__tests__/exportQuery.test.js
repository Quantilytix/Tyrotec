const { rangeStart, rangeEnd, applyDateRange, fetchAllRows, PAGE_SIZE } = require('../exportQuery');

describe('rangeStart / rangeEnd', () => {
  it('anchors both ends to South African time, inclusive of the whole day', () => {
    expect(rangeStart('2026-08-01')).toBe('2026-08-01T00:00:00.000+02:00');
    expect(rangeEnd('2026-08-31')).toBe('2026-08-31T23:59:59.999+02:00');
  });

  it('ignores anything that is not a plain date, rather than filtering on junk', () => {
    for (const bad of ['', null, undefined, 'yesterday', '2026-8-1', "2026-08-01'; drop table"]) {
      expect(rangeStart(bad)).toBeNull();
      expect(rangeEnd(bad)).toBeNull();
    }
  });
});

describe('applyDateRange', () => {
  const makeQuery = () => {
    const calls = [];
    const query = {
      calls,
      gte: (field, value) => {
        calls.push(['gte', field, value]);
        return query;
      },
      lte: (field, value) => {
        calls.push(['lte', field, value]);
        return query;
      },
    };
    return query;
  };

  it('applies only the end when no start is given, and vice versa', () => {
    expect(applyDateRange(makeQuery(), { to: '2026-08-31' }).calls).toEqual([
      ['lte', 'created_at', '2026-08-31T23:59:59.999+02:00'],
    ]);
    expect(applyDateRange(makeQuery(), { from: '2026-08-01' }).calls).toEqual([
      ['gte', 'created_at', '2026-08-01T00:00:00.000+02:00'],
    ]);
  });

  it('applies nothing when no dates are given', () => {
    expect(applyDateRange(makeQuery(), {}).calls).toEqual([]);
    expect(applyDateRange(makeQuery()).calls).toEqual([]);
  });
});

describe('fetchAllRows', () => {
  // A full first page means there may be more: PostgREST caps each response,
  // and stopping there would silently truncate a busy month's export.
  const buildPagedQuery = (total) => {
    const ranges = [];
    return {
      ranges,
      build: () => ({
        range: (from, to) => {
          ranges.push([from, to]);
          const rows = [];
          for (let i = from; i <= Math.min(to, total - 1); i += 1) rows.push({ i });
          return Promise.resolve({ data: rows, error: null });
        },
      }),
    };
  };

  it('returns everything across several pages', async () => {
    const paged = buildPagedQuery(PAGE_SIZE * 2 + 5);
    const rows = await fetchAllRows(paged.build);

    expect(rows).toHaveLength(PAGE_SIZE * 2 + 5);
    expect(paged.ranges).toEqual([
      [0, PAGE_SIZE - 1],
      [PAGE_SIZE, PAGE_SIZE * 2 - 1],
      [PAGE_SIZE * 2, PAGE_SIZE * 3 - 1],
    ]);
  });

  it('stops after one request when the first page is not full', async () => {
    const paged = buildPagedQuery(3);
    expect(await fetchAllRows(paged.build)).toHaveLength(3);
    expect(paged.ranges).toHaveLength(1);
  });

  it('surfaces a database error instead of returning a partial export', async () => {
    const build = () => ({ range: () => Promise.resolve({ data: null, error: { message: 'boom' } }) });
    await expect(fetchAllRows(build)).rejects.toMatchObject({ message: 'boom' });
  });
});

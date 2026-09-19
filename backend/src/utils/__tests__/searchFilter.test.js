const { matchesSearch, filterBySearch } = require('../searchFilter');

// Kept in step with frontend/src/utils/__tests__/searchFilter.test.js: the
// table on screen and the exported file must agree on what a search means.
const ORDERS = [
  { order_number: 52, users: { company_name: 'Buyer Co', email: 'buyer@example.com' } },
  { order_number: 7, users: { company_name: 'Acme Mining', email: 'ops@acme.co.za' } },
  { order_number: 152, users: { company_name: null, email: 'solo@example.com' } },
];

describe('matchesSearch', () => {
  const parts = ['52', 'Buyer Co', 'buyer@example.com'];

  it('matches with no term at all, so an empty search box filters nothing', () => {
    expect(matchesSearch('', parts)).toBe(true);
    expect(matchesSearch('   ', parts)).toBe(true);
    expect(matchesSearch(undefined, parts)).toBe(true);
  });

  it('matches on number, company or email, ignoring case', () => {
    expect(matchesSearch('52', parts)).toBe(true);
    expect(matchesSearch('buyer co', parts)).toBe(true);
    expect(matchesSearch('BUYER@EXAMPLE.COM', parts)).toBe(true);
  });

  it('ignores a leading # so "#52" finds order 52', () => {
    expect(matchesSearch('#52', parts)).toBe(true);
  });

  it('requires every word to match, so extra words narrow the result', () => {
    expect(matchesSearch('buyer 52', parts)).toBe(true);
    expect(matchesSearch('buyer 99', parts)).toBe(false);
  });

  it('skips missing fields instead of matching the word "null"', () => {
    expect(matchesSearch('null', ['152', null, 'solo@example.com'])).toBe(false);
  });
});

describe('filterBySearch', () => {
  it('returns every record when the term is blank', () => {
    expect(filterBySearch(ORDERS, '', 'order_number')).toHaveLength(3);
    expect(filterBySearch(ORDERS, undefined, 'order_number')).toBe(ORDERS);
  });

  it('finds a record by customer', () => {
    expect(filterBySearch(ORDERS, 'acme', 'order_number').map((o) => o.order_number)).toEqual([7]);
  });

  // "52" is a substring of "152", and both are legitimate matches for someone
  // typing a partial number.
  it('matches numbers as text, including partial numbers', () => {
    expect(filterBySearch(ORDERS, '52', 'order_number').map((o) => o.order_number)).toEqual([52, 152]);
  });

  it('returns nothing when the term matches no record', () => {
    expect(filterBySearch(ORDERS, 'zzz', 'order_number')).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { matchesSearch, recordSearchParts } from '../searchFilter';

// Kept in step with backend/src/utils/__tests__/searchFilter.test.js: the
// table on screen and the exported file must agree on what a search means.
const QUOTE = {
  quote_number: 52,
  users: { company_name: 'Buyer Co', email: 'buyer@example.com' },
};

describe('recordSearchParts', () => {
  it('covers the number, the company and the email', () => {
    expect(recordSearchParts(QUOTE, 'quote_number')).toEqual(['52', 'Buyer Co', 'buyer@example.com']);
  });

  it('copes with a customer who has no company name', () => {
    expect(recordSearchParts({ quote_number: 7, users: { email: 'solo@example.com' } }, 'quote_number')).toEqual([
      '7',
      undefined,
      'solo@example.com',
    ]);
  });
});

describe('matchesSearch', () => {
  const parts = recordSearchParts(QUOTE, 'quote_number');

  it('keeps everything when nothing is typed', () => {
    expect(matchesSearch('', parts)).toBe(true);
    expect(matchesSearch('  ', parts)).toBe(true);
  });

  it('matches number, company and email regardless of case', () => {
    expect(matchesSearch('52', parts)).toBe(true);
    expect(matchesSearch('BUYER CO', parts)).toBe(true);
    expect(matchesSearch('buyer@example.com', parts)).toBe(true);
  });

  it('ignores a leading # so "#52" finds quote 52', () => {
    expect(matchesSearch('#52', parts)).toBe(true);
  });

  it('narrows as more words are typed', () => {
    expect(matchesSearch('buyer 52', parts)).toBe(true);
    expect(matchesSearch('buyer acme', parts)).toBe(false);
  });

  it('does not match on a missing field', () => {
    expect(matchesSearch('undefined', ['7', undefined, 'solo@example.com'])).toBe(false);
  });
});

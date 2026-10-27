import { describe, expect, it } from 'vitest';
import { pageItems, clampPage } from '../pagination';

describe('pageItems', () => {
  it('shows every page when there are few', () => {
    expect(pageItems(1, 1)).toEqual([1]);
    expect(pageItems(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('shows first, last, the current page and its neighbours, with gaps', () => {
    expect(pageItems(5, 39)).toEqual([1, '…', 4, 5, 6, '…', 39]);
  });

  it('has no gap next to the first or last page', () => {
    expect(pageItems(1, 39)).toEqual([1, 2, '…', 39]);
    expect(pageItems(3, 39)).toEqual([1, 2, 3, 4, '…', 39]);
    expect(pageItems(39, 39)).toEqual([1, '…', 38, 39]);
  });
});

describe('clampPage', () => {
  it('keeps a typed page within range', () => {
    expect(clampPage('12', 39)).toBe(12);
    expect(clampPage('0', 39)).toBe(1);
    expect(clampPage('99', 39)).toBe(39);
    expect(clampPage('abc', 39)).toBeNull();
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { rememberNext, takeNext, rememberNextFromQuery, loginPathFor } from '../afterLogin';

// The tests run in Node, which has no sessionStorage: a minimal stand-in.
if (typeof globalThis.sessionStorage === 'undefined') {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

describe('afterLogin', () => {
  beforeEach(() => sessionStorage.clear());

  it('remembers a page on this site and hands it back once', () => {
    rememberNext('/cart');
    expect(takeNext()).toBe('/cart');
    expect(takeNext()).toBeNull();
  });

  it('keeps the query string', () => {
    rememberNext('/products?category=Pumps');
    expect(takeNext()).toBe('/products?category=Pumps');
  });

  it('never remembers an outside address', () => {
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'cart', '', null]) {
      rememberNext(bad);
      expect(takeNext()).toBeNull();
    }
  });

  it("doesn't send someone back to a sign-in page", () => {
    rememberNext('/login');
    expect(takeNext()).toBeNull();
    rememberNext('/register?next=/cart');
    expect(takeNext()).toBeNull();
  });

  it('reads ?next= from a link, and builds those links', () => {
    rememberNextFromQuery(`?next=${encodeURIComponent('/cart')}`);
    expect(takeNext()).toBe('/cart');
    expect(loginPathFor('/cart')).toBe('/login?next=%2Fcart');
  });

  it('ignores a ?next= that points away from the site', () => {
    rememberNextFromQuery('?next=https%3A%2F%2Fevil.example');
    expect(takeNext()).toBeNull();
  });
});

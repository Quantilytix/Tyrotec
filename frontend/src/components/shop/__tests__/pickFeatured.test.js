import { describe, it, expect } from 'vitest';
import { pickFeatured } from '../ShopFront';

const p = (id, extra = {}) => ({ id, image_url: `https://img/${id}.jpg`, stock_quantity: 5, ...extra });

describe('pickFeatured', () => {
  it('puts deals first, then products in stock', () => {
    const out = pickFeatured([p('deal1'), p('deal2')], [p('a'), p('b')]);
    expect(out.map((x) => x.id)).toEqual(['deal1', 'deal2', 'a', 'b']);
  });

  it('only shows products with a photo', () => {
    const out = pickFeatured([p('deal', { image_url: null })], [p('a'), p('b', { image_url: '' })]);
    expect(out.map((x) => x.id)).toEqual(['a']);
  });

  it('leaves out-of-stock products out of the "others", but keeps an out-of-stock deal', () => {
    const out = pickFeatured([p('deal', { stock_quantity: 0 })], [p('gone', { stock_quantity: 0 }), p('a')]);
    expect(out.map((x) => x.id)).toEqual(['deal', 'a']);
  });

  it("doesn't repeat a deal that's also in the general list, and stops at the limit", () => {
    const out = pickFeatured([p('x')], [p('x'), p('a'), p('b'), p('c')], 3);
    expect(out.map((x) => x.id)).toEqual(['x', 'a', 'b']);
  });
});

describe('pickSpotlight', () => {
  it('picks any product with a photo, at random', async () => {
    const { pickSpotlight } = await import('../ShopFront');
    const list = [p('a'), p('noPhoto', { image_url: null }), p('b'), p('c')];
    expect(pickSpotlight(list, () => 0).id).toBe('a');
    expect(pickSpotlight(list, () => 0.5).id).toBe('b');
    expect(pickSpotlight(list, () => 0.99).id).toBe('c');
  });

  it('has nothing to show when no product has a photo', async () => {
    const { pickSpotlight } = await import('../ShopFront');
    expect(pickSpotlight([p('x', { image_url: null })])).toBeNull();
    expect(pickSpotlight([])).toBeNull();
  });
});

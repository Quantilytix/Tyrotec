// priceQuoteItems: the pricing shared by creating and editing a quote.
const products = [
  { id: 'p1', unit_price: 1000, vat_applicable: true },
  { id: 'p2', unit_price: 200, vat_applicable: false },
  { id: 'p3', unit_price: 1000, vat_applicable: true, discount_id: 'd1', discount_percent: 15, discount_reason: 'Clearance', discount_ends_on: null },
];

jest.mock('../../config/supabase', () => ({
  from: () => ({
    select: () => ({
      in: (_col, ids) => Promise.resolve({ data: products.filter((p) => ids.includes(p.id)), error: null }),
    }),
  }),
}));
jest.mock('../notificationService', () => ({ notifyInternalTeam: jest.fn() }));
jest.mock('../discountService', () => ({ checkQuoteDiscounts: jest.fn() }));

const { priceQuoteItems } = require('../quoteService');

describe('priceQuoteItems', () => {
  it('prices each line from the catalogue and totals the quote', async () => {
    const { quoteItemsData, totals } = await priceQuoteItems([
      { product_id: 'p1', quantity: 2 },
      { product_id: 'p2', quantity: 1 },
    ]);
    expect(quoteItemsData).toEqual([
      expect.objectContaining({ product_id: 'p1', quantity: 2, unit_price: 1000, vat_rate: 15 }),
      expect.objectContaining({ product_id: 'p2', quantity: 1, unit_price: 200, vat_rate: 0 }),
    ]);
    expect(totals).toEqual({ subtotal_amount: 2200, vat_amount: 300, total_amount: 2500 });
  });

  it('combines the same product listed twice into one line', async () => {
    const { quoteItemsData } = await priceQuoteItems([
      { product_id: 'p1', quantity: 2 },
      { product_id: 'p1', quantity: 3 },
    ]);
    expect(quoteItemsData).toHaveLength(1);
    expect(quoteItemsData[0].quantity).toBe(5);
  });

  it("applies a product's current discount", async () => {
    const { quoteItemsData } = await priceQuoteItems([{ product_id: 'p3', quantity: 1 }]);
    expect(quoteItemsData[0]).toEqual(expect.objectContaining({ unit_price: 850, list_price: 1000, discount_percent: 15 }));
  });

  it('takes a staff discount off the normal price, with the reason', async () => {
    const { quoteItemsData } = await priceQuoteItems(
      [{ product_id: 'p1', quantity: 1, discount_percent: 10, discount_reason: 'Loyal customer' }],
      { staff: true }
    );
    expect(quoteItemsData[0]).toEqual(expect.objectContaining({
      unit_price: 900, list_price: 1000, discount_id: null, discount_percent: 10, discount_reason: 'Loyal customer',
    }));
  });

  it('a staff discount replaces a catalogue discount on the line', async () => {
    const { quoteItemsData } = await priceQuoteItems([{ product_id: 'p3', quantity: 1, discount_percent: 20 }], { staff: true });
    expect(quoteItemsData[0]).toEqual(expect.objectContaining({ unit_price: 800, discount_id: null, discount_reason: 'Staff discount' }));
  });

  it('ignores discounts a customer sends', async () => {
    const { quoteItemsData } = await priceQuoteItems([{ product_id: 'p1', quantity: 1, discount_percent: 50 }]);
    expect(quoteItemsData[0]).toEqual(expect.objectContaining({ unit_price: 1000, discount_percent: null }));
  });

  it("keeps staff discounts on a customer's edit", async () => {
    const keep = new Map([['p1', { percent: 10, reason: 'Loyal customer' }]]);
    const { quoteItemsData } = await priceQuoteItems([{ product_id: 'p1', quantity: 4 }], { keep });
    expect(quoteItemsData[0]).toEqual(expect.objectContaining({ quantity: 4, unit_price: 900, discount_reason: 'Loyal customer' }));
  });

  it('refuses a staff discount of 100% or more, or below 0', async () => {
    expect((await priceQuoteItems([{ product_id: 'p1', quantity: 1, discount_percent: 100 }], { staff: true })).status).toBe(400);
    expect((await priceQuoteItems([{ product_id: 'p1', quantity: 1, discount_percent: -5 }], { staff: true })).status).toBe(400);
  });

  it('refuses an empty quote or an unknown product', async () => {
    expect((await priceQuoteItems([])).status).toBe(400);
    expect((await priceQuoteItems([{ product_id: 'nope', quantity: 1 }])).error).toMatch(/not found/);
  });
});

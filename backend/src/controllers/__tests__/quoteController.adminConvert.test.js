jest.mock('../../config/supabase', () => ({ from: jest.fn(), rpc: jest.fn() }));
jest.mock('../../services/quoteService', () => ({
  createQuoteForCustomer: jest.fn(),
  convertQuoteForCustomer: jest.fn(),
}));
jest.mock('../../services/adminReviewService', () => ({
  flagIfNeeded: jest.fn(),
  flagStockShort: jest.fn(),
}));
jest.mock('../../services/notificationService', () => ({
  notifyInternalTeam: jest.fn(),
  notifyUser: jest.fn(),
  sendEmailOrThrow: jest.fn(),
}));
jest.mock('../../services/activityLogService', () => ({ logActivity: jest.fn(), logForUser: jest.fn() }));
jest.mock('../../services/quotePdfService', () => ({ generateQuotePdfBuffer: jest.fn() }));

const supabase = require('../../config/supabase');
const { convertQuoteForCustomer } = require('../../services/quoteService');
const { flagIfNeeded, flagStockShort } = require('../../services/adminReviewService');
const { notifyUser } = require('../../services/notificationService');
const { logActivity } = require('../../services/activityLogService');
const { convertQuoteToOrderAdmin } = require('../quoteController');

const QUOTE = {
  id: 'q-1',
  quote_number: 7,
  customer_id: 'cust-1',
  total_amount: 1150,
  users: { email: 'buyer@example.com', company_name: 'Buyer Co' },
};

const STAFF = { id: 'staff-1', email: 'rep@tyrotec.co.za', role: 'sales_rep', company_name: null };

// supabase.from('quotes') -> the lookup; supabase.from('orders') -> the totals
// read that follows a successful approval.
function quoteLookup(quote, error = null) {
  const q = {};
  q.select = jest.fn(() => q);
  q.eq = jest.fn(() => q);
  q.single = jest.fn(() => Promise.resolve({ data: quote, error }));
  return q;
}

function orderTotals(order) {
  const q = {};
  q.select = jest.fn(() => q);
  q.eq = jest.fn(() => q);
  q.single = jest.fn(() => Promise.resolve({ data: order, error: null }));
  return q;
}

function run(quoteId = 'q-1', user = STAFF) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(body) { resolve({ status: this.statusCode, body }); return this; },
    };
    convertQuoteToOrderAdmin({ params: { quoteId }, user }, res, (err) => resolve({ status: 500, err }));
  });
}

describe('POST /api/quotes/:quoteId/admin-convert', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    supabase.from.mockReset();
    supabase.rpc.mockReset();
    convertQuoteForCustomer.mockResolvedValue({ orderId: 'order-1', orderNumber: 12, quoteNumber: 7 });
  });

  // The point of the feature: one action gets the order all the way to a
  // state that can take a payment, so staff aren't asked to approve an order
  // they just created themselves.
  it('creates the order and commits the stock, landing it awaiting payment', async () => {
    supabase.from.mockReturnValueOnce(quoteLookup(QUOTE)).mockReturnValueOnce(
      orderTotals({ subtotal_amount: 1000, vat_amount: 150, total_amount: 1150 })
    );
    supabase.rpc.mockResolvedValue({ error: null });

    const { status, body } = await run();

    expect(status).toBe(201);
    expect(body).toMatchObject({ orderId: 'order-1', orderNumber: 12, status: 'approved', stockShort: false });
    expect(supabase.rpc).toHaveBeenCalledWith('approve_order', { p_order_id: 'order-1' });
    expect(flagStockShort).not.toHaveBeenCalled();
  });

  // 'admin' is what separates a staff-placed order from the customer's own in
  // exports and the activity log.
  it('records the order as placed by staff, not through the portal', async () => {
    supabase.from.mockReturnValueOnce(quoteLookup(QUOTE)).mockReturnValueOnce(orderTotals({ subtotal_amount: 1000 }));
    supabase.rpc.mockResolvedValue({ error: null });

    await run();

    expect(convertQuoteForCustomer).toHaveBeenCalledWith('cust-1', 'Buyer Co', 'q-1', 'admin');
  });

  it('raises the usual high-value / first-order flags on the excl-VAT amount', async () => {
    supabase.from.mockReturnValueOnce(quoteLookup(QUOTE)).mockReturnValueOnce(
      orderTotals({ subtotal_amount: 90000, vat_amount: 13500, total_amount: 103500 })
    );
    supabase.rpc.mockResolvedValue({ error: null });

    await run();

    expect(flagIfNeeded).toHaveBeenCalledWith('order-1', 'cust-1', 90000);
  });

  it('tells the customer their order was placed', async () => {
    supabase.from.mockReturnValueOnce(quoteLookup(QUOTE)).mockReturnValueOnce(orderTotals({ subtotal_amount: 1000 }));
    supabase.rpc.mockResolvedValue({ error: null });

    await run();

    expect(notifyUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'cust-1', email: 'buyer@example.com', title: 'Your order has been placed' })
    );
  });

  // approve_order refuses rather than overselling. The order must survive as
  // a pending one for staff to decide on, not vanish or go payable.
  it('leaves the order awaiting approval when stock is short, and flags it', async () => {
    supabase.from.mockReturnValueOnce(quoteLookup(QUOTE));
    supabase.rpc.mockResolvedValue({ error: { message: 'Insufficient stock for product Bearing (have 2, need 10)' } });

    const { status, body } = await run();

    expect(status).toBe(201);
    expect(body).toMatchObject({ orderId: 'order-1', status: 'pending_approval', stockShort: true });
    expect(body.message).toMatch(/not enough stock/i);
    expect(flagStockShort).toHaveBeenCalledWith('order-1');
    expect(flagIfNeeded).not.toHaveBeenCalled();
  });

  it('404s on a quote that does not exist', async () => {
    supabase.from.mockReturnValueOnce(quoteLookup(null, { message: 'no rows' }));

    const { status, body } = await run('nope');

    expect(status).toBe(404);
    expect(body).toEqual({ error: 'Quote not found.' });
    expect(convertQuoteForCustomer).not.toHaveBeenCalled();
  });

  // A quote already turned into an order, or voided, must not produce a
  // second one -- the service owns that rule and the controller must respect
  // its refusal rather than carrying on to approve_order.
  it('passes through the service refusing an already-converted quote', async () => {
    supabase.from.mockReturnValueOnce(quoteLookup(QUOTE));
    convertQuoteForCustomer.mockResolvedValue({ error: 'Quote already converted', status: 400 });

    const { status, body } = await run();

    expect(status).toBe(400);
    expect(body).toEqual({ error: 'Quote already converted' });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('passes through the service refusing an expired quote', async () => {
    supabase.from.mockReturnValueOnce(quoteLookup(QUOTE));
    convertQuoteForCustomer.mockResolvedValue({ error: 'Quote has expired', status: 400 });

    const { status } = await run();

    expect(status).toBe(400);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('logs who placed the order, under the real order number', async () => {
    supabase.from.mockReturnValueOnce(quoteLookup(QUOTE)).mockReturnValueOnce(orderTotals({ subtotal_amount: 1000 }));
    supabase.rpc.mockResolvedValue({ error: null });

    await run();

    const entry = logActivity.mock.calls[0][0];
    expect(entry).toMatchObject({ actorId: 'staff-1', actorRole: 'sales_rep', entityId: 'order-1' });
    expect(entry.description).toContain('#12');
    expect(entry.description).toContain('rep@tyrotec.co.za');
  });

  // A customer with no company name still has to be nameable in the log.
  it('falls back to the customer email when there is no company name', async () => {
    supabase.from
      .mockReturnValueOnce(quoteLookup({ ...QUOTE, users: { email: 'solo@example.com', company_name: null } }))
      .mockReturnValueOnce(orderTotals({ subtotal_amount: 1000 }));
    supabase.rpc.mockResolvedValue({ error: null });

    await run();

    expect(convertQuoteForCustomer).toHaveBeenCalledWith('cust-1', 'solo@example.com', 'q-1', 'admin');
  });
});

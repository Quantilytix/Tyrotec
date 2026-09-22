jest.mock('../../config/supabase', () => ({ from: jest.fn() }));
jest.mock('../notificationService', () => ({ notifyUser: jest.fn() }));
jest.mock('../orderStateService', () => ({ transitionOrderStatus: jest.fn() }));

const supabase = require('../../config/supabase');
const { notifyUser } = require('../notificationService');
const { transitionOrderStatus } = require('../orderStateService');

// One chainable stand-in per supabase.from() call. `single` is what a
// .single() terminator resolves to; `resolve` is what awaiting the chain
// itself resolves to (the existing-payments lookup ends on .in(), with no
// .single()).
function builder({ single, resolve } = {}) {
  const b = {};
  for (const method of ['select', 'insert', 'update', 'eq', 'in', 'order', 'limit']) {
    b[method] = jest.fn(() => b);
  }
  b.single = jest.fn(() => Promise.resolve(single));
  if (resolve) b.then = (onOk, onErr) => Promise.resolve(resolve).then(onOk, onErr);
  return b;
}

const ORDER = {
  id: 'order-1',
  order_number: 12,
  status: 'stock_reserved',
  customer_id: 'cust-1',
  total_amount: 1150,
  users: { email: 'buyer@example.com', company_name: 'Buyer Co', phone: '+27820000000' },
};

// orders lookup -> existing-payment check -> payment insert
function mockChain({ order = ORDER, existing = [], inserted = { id: 'pay-1' } } = {}) {
  const insertBuilder = builder({ single: { data: inserted, error: null } });
  supabase.from
    .mockReturnValueOnce(builder({ single: { data: order, error: order ? null : { message: 'x' } } }))
    .mockReturnValueOnce(builder({ resolve: { data: existing, error: null } }))
    .mockReturnValueOnce(insertBuilder);
  return insertBuilder;
}

describe('recordStaffPayment', () => {
  let recordStaffPayment;

  beforeEach(() => {
    jest.clearAllMocks();
    supabase.from.mockReset();
    transitionOrderStatus.mockResolvedValue({ order: { id: 'order-1', status: 'confirmed' } });
    ({ recordStaffPayment } = require('../paymentService'));
  });

  // The whole point of the change: one action writes the money *and* moves
  // the order, so nothing is left sitting in stock_reserved for the
  // reservation-expiry job to cancel out from under a paid customer.
  it('writes the payment already approved and confirms the order', async () => {
    const insertBuilder = mockChain();

    const result = await recordStaffPayment('order-1', 'staff-1', {
      method: 'bank_transfer',
      reference: 'FNB-99',
      amount: 1150,
    });

    const [[row]] = insertBuilder.insert.mock.calls[0];
    expect(row).toMatchObject({
      order_id: 'order-1',
      customer_id: 'cust-1',
      method: 'bank_transfer',
      reference: 'FNB-99',
      amount: 1150,
      status: 'approved',
      source: 'admin',
      reviewed_by: 'staff-1',
    });
    expect(row.reviewed_at).toEqual(expect.any(String));
    expect(row.verified_at).toEqual(expect.any(String));

    expect(transitionOrderStatus).toHaveBeenCalledWith('order-1', 'confirmed');
    expect(result).toMatchObject({ paymentId: 'pay-1', orderNumber: 12, orderStatus: 'confirmed' });
  });

  it('notifies the customer that the payment landed', async () => {
    mockChain();

    await recordStaffPayment('order-1', 'staff-1', { method: 'cash', reference: 'R-1', amount: 1150 });

    expect(notifyUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'cust-1',
        title: 'Payment received',
        email: 'buyer@example.com',
        phone: '+27820000000',
      })
    );
  });

  it('works for an order placed on account, awaiting its invoice payment', async () => {
    mockChain({ order: { ...ORDER, status: 'awaiting_payment' } });

    const result = await recordStaffPayment('order-1', 'staff-1', {
      method: 'bank_transfer',
      reference: 'INV-204',
      amount: 1150,
    });

    expect(result.error).toBeUndefined();
    expect(transitionOrderStatus).toHaveBeenCalledWith('order-1', 'confirmed');
  });

  it('works for an approved order settled offline, not just a reserved one', async () => {
    mockChain({ order: { ...ORDER, status: 'approved' } });

    const result = await recordStaffPayment('order-1', 'staff-1', {
      method: 'bank_transfer',
      reference: 'EFT-7',
      amount: 1150,
    });

    expect(result.error).toBeUndefined();
    expect(transitionOrderStatus).toHaveBeenCalledWith('order-1', 'confirmed');
  });

  it('refuses an order that is not awaiting payment', async () => {
    supabase.from.mockReturnValueOnce(
      builder({ single: { data: { ...ORDER, status: 'completed' }, error: null } })
    );

    const result = await recordStaffPayment('order-1', 'staff-1', {
      method: 'cash',
      reference: 'R-1',
      amount: 1150,
    });

    expect(result).toEqual({ error: 'An order that is "completed" can\'t take a payment.', status: 400 });
    expect(transitionOrderStatus).not.toHaveBeenCalled();
  });

  it('refuses to double-pay an order that already has a payment', async () => {
    supabase.from
      .mockReturnValueOnce(builder({ single: { data: ORDER, error: null } }))
      .mockReturnValueOnce(builder({ resolve: { data: [{ id: 'pay-existing' }], error: null } }));

    const result = await recordStaffPayment('order-1', 'staff-1', {
      method: 'cash',
      reference: 'R-1',
      amount: 1150,
    });

    expect(result).toEqual({ error: 'This order has already been paid.', status: 400 });
    expect(transitionOrderStatus).not.toHaveBeenCalled();
  });

  it('404s on an unknown order', async () => {
    supabase.from.mockReturnValueOnce(builder({ single: { data: null, error: { message: 'no rows' } } }));

    const result = await recordStaffPayment('nope', 'staff-1', {
      method: 'cash',
      reference: 'R-1',
      amount: 1150,
    });

    expect(result).toEqual({ error: 'Order not found', status: 404 });
  });

  // The payment row records real money, so a failed status move is reported
  // rather than rolled back -- staff can move the order by hand, but they
  // must be told it didn't move on its own.
  it('reports a failed status move without losing the payment', async () => {
    const insertBuilder = mockChain();
    transitionOrderStatus.mockResolvedValue({ error: 'Cannot move order from "cancelled" to "confirmed".' });

    const result = await recordStaffPayment('order-1', 'staff-1', {
      method: 'cash',
      reference: 'R-1',
      amount: 1150,
    });

    expect(insertBuilder.insert).toHaveBeenCalled();
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/Payment recorded, but the order could not be marked as paid/);
    expect(notifyUser).not.toHaveBeenCalled();
  });
});

describe('reviewPayment', () => {
  let reviewPayment;

  beforeEach(() => {
    jest.clearAllMocks();
    supabase.from.mockReset();
    transitionOrderStatus.mockResolvedValue({ order: { id: 'order-1', status: 'confirmed' } });
    ({ reviewPayment } = require('../paymentService'));
  });

  const SUBMITTED = {
    id: 'pay-1',
    status: 'submitted',
    customer_id: 'cust-1',
    order_id: 'order-1',
    users: { email: 'buyer@example.com', company_name: 'Buyer Co', phone: null },
    orders: { order_number: 12, status: 'stock_reserved' },
  };

  it('confirms the order when a leftover submitted payment is approved', async () => {
    supabase.from
      .mockReturnValueOnce(builder({ single: { data: SUBMITTED, error: null } }))
      .mockReturnValueOnce(builder({ resolve: { error: null } }));

    const result = await reviewPayment('pay-1', 'approved', 'staff-1');

    expect(transitionOrderStatus).toHaveBeenCalledWith('order-1', 'confirmed');
    expect(result).toMatchObject({ paymentId: 'pay-1', status: 'approved', orderNumber: 12 });
  });

  it('leaves an order alone when it has already moved past payment', async () => {
    supabase.from
      .mockReturnValueOnce(
        builder({
          single: {
            data: { ...SUBMITTED, orders: { order_number: 12, status: 'ready_for_collection' } },
            error: null,
          },
        })
      )
      .mockReturnValueOnce(builder({ resolve: { error: null } }));

    await reviewPayment('pay-1', 'approved', 'staff-1');

    expect(transitionOrderStatus).not.toHaveBeenCalled();
  });

  it('does not confirm an order when the payment is rejected', async () => {
    supabase.from
      .mockReturnValueOnce(builder({ single: { data: SUBMITTED, error: null } }))
      .mockReturnValueOnce(builder({ resolve: { error: null } }));

    await reviewPayment('pay-1', 'rejected', 'staff-1');

    expect(transitionOrderStatus).not.toHaveBeenCalled();
    expect(notifyUser).not.toHaveBeenCalled();
  });

  it('rejects a payment that was already reviewed', async () => {
    supabase.from.mockReturnValueOnce(
      builder({ single: { data: { ...SUBMITTED, status: 'approved' }, error: null } })
    );

    const result = await reviewPayment('pay-1', 'approved', 'staff-1');

    expect(result.status).toBe(400);
    expect(result.error).toMatch(/already "approved"/);
  });

  it('validates the requested status', async () => {
    const result = await reviewPayment('pay-1', 'maybe', 'staff-1');
    expect(result).toEqual({ error: "Status must be 'approved' or 'rejected'.", status: 400 });
  });
});

// Chainable mock matching the two query shapes orderStateService.js uses:
//   supabase.from('orders').select(...).eq(...).single()
//   supabase.from('orders').update(...).eq(...).select().single()
function makeSupabaseMock({ selectResult, updateResult }) {
  const builder = {
    select: jest.fn(() => builder),
    update: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    single: jest.fn(),
  };
  // First .single() call (after select) resolves the find; second (after
  // update) resolves the update -- matches the two sequential calls
  // transitionOrderStatus makes against the same mocked builder.
  builder.single
    .mockResolvedValueOnce(selectResult)
    .mockResolvedValueOnce(updateResult);
  return { from: jest.fn(() => builder), _builder: builder };
}

describe('orderStateService', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  describe('ORDER_TRANSITIONS / allowedNextStatuses', () => {
    it('every terminal status allows no further transitions', () => {
      const { allowedNextStatuses } = require('../orderStateService');
      for (const terminal of ['completed', 'cancelled']) {
        expect(allowedNextStatuses(terminal)).toEqual([]);
      }
    });

    // Marking an order collected is the last step staff take, so
    // ready_for_collection leads to completed rather than being terminal.
    it('lets a ready order be marked collected', () => {
      const { allowedNextStatuses } = require('../orderStateService');
      expect(allowedNextStatuses('ready_for_collection')).toEqual(['completed']);
    });

    it('returns [] for a status the map has no entry for at all', () => {
      const { allowedNextStatuses } = require('../orderStateService');
      expect(allowedNextStatuses('not_a_real_status')).toEqual([]);
    });

    it('matches the documented manual-approval chain', () => {
      const { allowedNextStatuses } = require('../orderStateService');
      expect(allowedNextStatuses('pending_approval')).toEqual(['approved', 'cancelled']);
      expect(allowedNextStatuses('approved')).toEqual(['confirmed', 'processing', 'cancelled']);
      expect(allowedNextStatuses('processing')).toEqual(['completed', 'cancelled']);
    });

    // A staff-recorded offline payment confirms an 'approved' order, which is
    // what keeps both kinds of paid order (PayFast and EFT) on the same
    // confirmed -> ready_for_collection path.
    it('lets an approved order be confirmed by a recorded payment', () => {
      const { allowedNextStatuses } = require('../orderStateService');
      expect(allowedNextStatuses('approved')).toContain('confirmed');
    });

    it('matches the documented fast-checkout chain', () => {
      const { allowedNextStatuses } = require('../orderStateService');
      expect(allowedNextStatuses('stock_reserved')).toEqual([
        'confirmed',
        'awaiting_payment',
        'cancelled',
      ]);
      expect(allowedNextStatuses('confirmed')).toEqual(['ready_for_collection', 'cancelled']);
    });

    // Pay-on-invoice orders have no reservation and no timer: the only way
    // out is a recorded payment (confirmed) or staff calling it off.
    it('matches the documented pay-on-invoice chain', () => {
      const { allowedNextStatuses } = require('../orderStateService');
      expect(allowedNextStatuses('awaiting_payment')).toEqual(['confirmed', 'cancelled']);
    });

    // Anything still in flight can be called off, which restocks it. The one
    // exception is ready_for_collection: that order is already paid for and
    // picked, so unwinding it is a refund conversation, not a status change.
    it('every unfinished status can reach cancelled, except a paid and packed one', () => {
      const { ORDER_TRANSITIONS, allowedNextStatuses } = require('../orderStateService');
      const inFlight = Object.keys(ORDER_TRANSITIONS).filter(
        (status) => allowedNextStatuses(status).length > 0 && status !== 'ready_for_collection'
      );
      for (const status of inFlight) {
        expect(allowedNextStatuses(status)).toContain('cancelled');
      }
      expect(allowedNextStatuses('ready_for_collection')).not.toContain('cancelled');
    });

    // The customer choosing to be invoiced instead of paying online: same
    // order, reservation dropped so no timer applies.
    it('lets a reserved order become an invoice', () => {
      const { allowedNextStatuses } = require('../orderStateService');
      expect(allowedNextStatuses('stock_reserved')).toContain('awaiting_payment');
    });
  });

  describe('transitionOrderStatus', () => {
    it('returns a 404-shaped error when the order does not exist', async () => {
      jest.doMock('../../config/supabase', () =>
        makeSupabaseMock({ selectResult: { data: null, error: { message: 'not found' } } })
      );
      const { transitionOrderStatus } = require('../orderStateService');

      const result = await transitionOrderStatus('missing-id', 'approved');
      expect(result).toEqual({ error: 'Order not found', status: 404 });
    });

    it('refuses an illegal transition without ever calling update', async () => {
      const mock = makeSupabaseMock({
        selectResult: { data: { id: 'o1', status: 'completed' }, error: null },
      });
      jest.doMock('../../config/supabase', () => mock);
      const { transitionOrderStatus } = require('../orderStateService');

      const result = await transitionOrderStatus('o1', 'processing');

      expect(result.status).toBe(400);
      expect(result.error).toMatch(/Cannot move order from "completed" to "processing"/);
      expect(mock._builder.update).not.toHaveBeenCalled();
    });

    it('applies a legal transition and returns the updated order', async () => {
      const updatedOrder = { id: 'o1', status: 'processing' };
      const mock = makeSupabaseMock({
        selectResult: { data: { id: 'o1', status: 'approved' }, error: null },
        updateResult: { data: updatedOrder, error: null },
      });
      jest.doMock('../../config/supabase', () => mock);
      const { transitionOrderStatus } = require('../orderStateService');

      const result = await transitionOrderStatus('o1', 'processing');

      expect(result).toEqual({ order: updatedOrder });
      expect(mock._builder.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'processing' })
      );
    });

    it('throws if the update itself fails at the database level', async () => {
      const mock = makeSupabaseMock({
        selectResult: { data: { id: 'o1', status: 'approved' }, error: null },
        updateResult: { data: null, error: { message: 'db exploded' } },
      });
      jest.doMock('../../config/supabase', () => mock);
      const { transitionOrderStatus } = require('../orderStateService');

      await expect(transitionOrderStatus('o1', 'processing')).rejects.toEqual({
        message: 'db exploded',
      });
    });
  });
});

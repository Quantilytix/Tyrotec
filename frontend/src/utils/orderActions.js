// What staff can do next with an order or invoice. Shared by its page and the
// Orders/Invoices lists, so both offer the same steps.

// Status steps from each stored status. Deliberately absent: anything that
// moves an order to 'confirmed' (paid) -- that takes a verified PayFast
// payment or a recorded one, never a picked status -- and 'stock_reserved' /
// 'awaiting_payment', which checkout sets.
export const STATUS_MOVES = {
  pending_approval: [{ status: 'approved', label: 'Approve' }],
  processing: [{ status: 'completed', label: 'Mark completed' }],
  confirmed: [
    { status: 'ready_for_collection', label: 'Mark ready for collection' },
    { status: 'completed', label: 'Mark delivered' },
  ],
  ready_for_collection: [{ status: 'completed', label: 'Mark collected' }],
};

// Every order that hasn't finished can be called off.
export const CANCELLABLE = ['pending_approval', 'approved', 'processing', 'stock_reserved', 'awaiting_payment', 'confirmed'];

// Only one payment can be submitted/approved at a time (enforced server-side).
export function activePaymentOf(order) {
  return order?.payments?.find((p) => p.status === 'submitted' || p.status === 'approved');
}

// 'pending_approval' too: a customer may pay before the order is approved,
// or while it waits for stock (043).
export function canRecordPayment(order) {
  return ['pending_approval', 'approved', 'stock_reserved', 'awaiting_payment'].includes(order?.status) && !activePaymentOf(order);
}

// The lines an order awaiting approval can't be supplied yet. Needs each
// item's products.stock_quantity.
export function shortLinesOf(order) {
  return order?.status === 'pending_approval'
    ? (order.order_items || []).filter((item) => item.products && item.quantity > item.products.stock_quantity)
    : [];
}

// The status steps open to this order now. Approving needs every line in
// stock; an order short of stock is approved by recording its stock instead
// ("Stock received"), or automatically when stock arrives.
export function statusMovesFor(order) {
  const short = shortLinesOf(order).length > 0;
  return (STATUS_MOVES[order?.status] || []).filter((move) => !(move.status === 'approved' && short));
}

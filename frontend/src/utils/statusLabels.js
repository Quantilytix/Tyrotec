// One source of truth for how a stored status is worded in the UI, shared by
// StatusBadge and the admin filter dropdowns -- a filter that said "Submitted"
// while the table showed "Quote Finalized" would read like two different
// things.
//
// The backend's Excel export mirrors this map (backend/src/services/exportService.js)
// so a downloaded file matches the screen it came from.

// The database grew two parallel sets of order statuses: the staff-approval
// chain (pending_approval -> approved -> processing -> completed) and the
// self-service chain (stock_reserved/awaiting_payment -> confirmed ->
// ready_for_collection). They describe the same journey in two vocabularies,
// which made an order list read like two different systems.
//
// Rather than migrate the stored values -- risky, and pointless when the only
// problem is the words -- several statuses share one label. "Awaiting
// payment" covers all three ways an order can be waiting for money, because
// to the person reading the screen there is no difference.
export const STATUS_LABELS = {
  // quotes
  submitted: 'Quote Finalized',
  converted: 'Converted',
  expired: 'Expired',
  // orders, in the order the journey happens
  pending_approval: 'Awaiting approval',
  approved: 'Awaiting payment',
  stock_reserved: 'Awaiting payment',
  awaiting_payment: 'Awaiting payment',
  confirmed: 'Paid',
  processing: 'Paid',
  ready_for_collection: 'Ready for collection',
  completed: 'Completed',
  cancelled: 'Cancelled',
  // Not stored: an order paid while it waits for stock (orderDisplayStatus).
  paid_awaiting_stock: 'Paid · awaiting stock',
  // payment statuses -- prefixed with payment_ at the call site
  payment_submitted: 'Submitted',
  payment_approved: 'Paid',
  payment_rejected: 'Rejected',
  payment_cancelled: 'Cancelled',
};

export function statusLabel(status) {
  return STATUS_LABELS[status] || status?.replace(/_/g, ' ') || 'unknown';
}

// The status an order is shown with. Staff can record a payment on an order
// still waiting for stock (043); it stays 'pending_approval' until the stock
// arrives, but to anyone reading the screen it's paid.
export function orderDisplayStatus(order) {
  if (order?.status === 'pending_approval' && order.payments?.some((p) => p.status === 'approved')) {
    return 'paid_awaiting_stock';
  }
  return order?.status;
}

// A payment's badge beside its order's, where a bare "Cancelled" would read
// as the order's status.
export const PAYMENT_BADGE_LABELS = {
  submitted: 'Payment submitted',
  approved: 'Paid',
  rejected: 'Payment rejected',
  cancelled: 'Payment cancelled',
};

export const QUOTE_STATUSES = ['submitted', 'converted', 'expired'];

// What the admin Orders filter offers: the six stages a person actually
// thinks in, each covering however many stored statuses mean that stage.
// Listed in the order they occur in the flow rather than alphabetically, so
// the dropdown reads like the process.
export const ORDER_STATUS_GROUPS = [
  { value: 'awaiting_approval', label: 'Awaiting approval', statuses: ['pending_approval'] },
  {
    value: 'awaiting_payment',
    label: 'Awaiting payment',
    statuses: ['approved', 'stock_reserved', 'awaiting_payment'],
  },
  { value: 'paid', label: 'Paid', statuses: ['confirmed', 'processing', 'paid_awaiting_stock'] },
  { value: 'ready', label: 'Ready for collection', statuses: ['ready_for_collection'] },
  { value: 'completed', label: 'Completed', statuses: ['completed'] },
  { value: 'cancelled', label: 'Cancelled', statuses: ['cancelled'] },
];

// True when an order's stored status belongs to the chosen filter group.
// 'all' matches everything.
export function matchesStatusGroup(groupValue, status) {
  if (!groupValue || groupValue === 'all') return true;
  const group = ORDER_STATUS_GROUPS.find((g) => g.value === groupValue);
  return group ? group.statuses.includes(status) : false;
}

export function statusGroupLabel(groupValue) {
  return ORDER_STATUS_GROUPS.find((g) => g.value === groupValue)?.label || groupValue;
}

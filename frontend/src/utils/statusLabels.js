// One source of truth for how a stored status is worded in the UI, shared by
// StatusBadge and the admin filter dropdowns -- a filter that said "Submitted"
// while the table showed "Quote Finalized" would read like two different
// things.
//
// The backend's Excel export mirrors this map (backend/src/services/exportService.js)
// so a downloaded file matches the screen it came from.

// Overrides the default "underscore -> space" label for statuses that need
// wording different from the raw DB value (e.g. quotes are "finalized" from
// the customer's point of view, even though the stored status is 'submitted').
export const STATUS_LABELS = {
  submitted: 'Quote Finalized',
  confirmed: 'Paid',
  payment_submitted: 'Payment submitted',
  payment_approved: 'Payment approved',
  payment_rejected: 'Payment rejected',
};

export function statusLabel(status) {
  return STATUS_LABELS[status] || status?.replace(/_/g, ' ') || 'unknown';
}

// The statuses each admin list can actually contain, in the order they occur
// in the flow (docs/order-flow.md) rather than alphabetically, so the dropdown
// reads like the process.
export const QUOTE_STATUSES = ['submitted', 'converted', 'expired'];

export const ORDER_STATUSES = [
  'pending_approval',
  'approved',
  'processing',
  'completed',
  'stock_reserved',
  'confirmed',
  'ready_for_collection',
  'cancelled',
];

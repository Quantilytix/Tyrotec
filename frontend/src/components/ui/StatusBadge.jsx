import { statusLabel } from '../../utils/statusLabels';

// Colour follows the *stage*, not the stored value, so the statuses that
// share a label in statusLabels.js also share an appearance. Amber means
// "waiting on someone", teal "money is in", green "done".
const STYLES = {
  // quotes
  submitted: 'bg-amber-50 text-amber-600',
  converted: 'bg-good-50 text-good-500',
  expired: 'bg-slate-100 text-slate-500',
  // orders
  pending_approval: 'bg-amber-50 text-amber-600',
  approved: 'bg-amber-50 text-amber-600',
  stock_reserved: 'bg-amber-50 text-amber-600',
  awaiting_payment: 'bg-amber-50 text-amber-600',
  confirmed: 'bg-teal-50 text-teal-600',
  processing: 'bg-teal-50 text-teal-600',
  ready_for_collection: 'bg-good-50 text-good-500',
  completed: 'bg-good-50 text-good-500',
  cancelled: 'bg-bad-50 text-bad-500',
  // payment statuses -- prefixed with payment_ at the call site so they
  // don't collide with the quote/order statuses above.
  payment_submitted: 'bg-amber-50 text-amber-600',
  payment_approved: 'bg-good-50 text-good-500',
  payment_rejected: 'bg-bad-50 text-bad-500',
};

const DOT_STYLES = {
  submitted: 'bg-amber-500',
  converted: 'bg-good-500',
  expired: 'bg-slate-400',
  pending_approval: 'bg-amber-500',
  approved: 'bg-amber-500',
  stock_reserved: 'bg-amber-500',
  awaiting_payment: 'bg-amber-500',
  confirmed: 'bg-teal-500',
  processing: 'bg-teal-500',
  ready_for_collection: 'bg-good-500',
  completed: 'bg-good-500',
  cancelled: 'bg-bad-500',
  payment_submitted: 'bg-amber-500',
  payment_approved: 'bg-good-500',
  payment_rejected: 'bg-bad-500',
};

export default function StatusBadge({ status }) {
  const label = statusLabel(status);
  const style = STYLES[status] || 'bg-slate-100 text-slate-500';
  const dot = DOT_STYLES[status] || 'bg-slate-400';

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium capitalize ${style}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

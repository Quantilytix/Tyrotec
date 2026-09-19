import { statusLabel } from '../../utils/statusLabels';

const STYLES = {
  // quote statuses
  submitted: 'bg-amber-50 text-amber-600',
  converted: 'bg-good-50 text-good-500',
  expired: 'bg-slate-100 text-slate-500',
  // order statuses
  pending_approval: 'bg-amber-50 text-amber-600',
  approved: 'bg-teal-50 text-teal-600',
  processing: 'bg-teal-50 text-teal-600',
  completed: 'bg-good-50 text-good-500',
  cancelled: 'bg-bad-50 text-bad-500',
  // fast-checkout order statuses (PayFast path)
  stock_reserved: 'bg-amber-50 text-amber-600',
  confirmed: 'bg-teal-50 text-teal-600',
  ready_for_collection: 'bg-good-50 text-good-500',
  // payment statuses -- prefixed with payment_ at the call site so they
  // don't collide with the quote/order statuses above (e.g. a submitted
  // payment must not pick up quotes' "submitted" style/label).
  payment_submitted: 'bg-amber-50 text-amber-600',
  payment_approved: 'bg-good-50 text-good-500',
  payment_rejected: 'bg-bad-50 text-bad-500',
};

const DOT_STYLES = {
  submitted: 'bg-amber-500',
  converted: 'bg-good-500',
  expired: 'bg-slate-400',
  pending_approval: 'bg-amber-500',
  approved: 'bg-teal-500',
  processing: 'bg-teal-500',
  completed: 'bg-good-500',
  cancelled: 'bg-bad-500',
  stock_reserved: 'bg-amber-500',
  confirmed: 'bg-teal-500',
  ready_for_collection: 'bg-good-500',
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

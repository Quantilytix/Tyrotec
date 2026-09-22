import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPendingReviews, resolveReview } from '../../api/adminReviews';
import { formatCurrency, formatDate } from '../../utils/formatters';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';

// Action pairs per review reason -- mirrors resolveReview's branching in
// adminReviewService.js exactly, so the buttons shown here are always ones
// the backend will actually accept.
const REASON_ACTIONS = {
  stock_short: [
    { action: 'approve', label: 'Approve anyway', variant: 'primary' },
    { action: 'reject', label: 'Reject', variant: 'danger' },
  ],
  high_value: [
    { action: 'acknowledge', label: 'Acknowledge', variant: 'secondary' },
    { action: 'cancel', label: 'Cancel order', variant: 'danger' },
  ],
  new_customer: [
    { action: 'acknowledge', label: 'Acknowledge', variant: 'secondary' },
    { action: 'cancel', label: 'Cancel order', variant: 'danger' },
  ],
};

const REASON_LABELS = {
  stock_short: 'Insufficient stock',
  high_value: 'High-value order',
  new_customer: 'First-time customer',
};

export default function AdminReviewsPage() {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState(null);
  const [error, setError] = useState('');
  const [pendingConfirm, setPendingConfirm] = useState(null); // { reviewId, action, label } | null
  const navigate = useNavigate();

  const load = () => getPendingReviews().then(({ data }) => setReviews(data));

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  const handleResolve = async (id, action) => {
    setError('');
    setActingId(id);
    try {
      await resolveReview(id, action);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not resolve this review.');
    } finally {
      setActingId(null);
      setPendingConfirm(null);
    }
  };

  // 'reject'/'cancel' (the danger-variant actions) end the order/payment
  // outright and can't be undone from here -- worth a confirm step, unlike
  // 'approve'/'acknowledge' which just let the automated path continue.
  const handleActionClick = (review, { action, variant, label }) => {
    if (variant === 'danger') {
      setPendingConfirm({ reviewId: review.id, action, label, orderNumber: review.orders?.order_number });
      return;
    }
    handleResolve(review.id, action);
  };

  return (
    <div>
      <h1 className="font-display text-xl font-semibold text-ink">Review queue</h1>
      <p className="mt-1 text-sm text-slate-500">
        Orders the automated checkout couldn't fully handle on its own. Worked independently, one at a time.
      </p>

      {error && <p className="mt-4 rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-500">{error}</p>}

      {loading ? (
        <Spinner />
      ) : reviews.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="Nothing pending" description="Every order is either fully automated or already resolved." />
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {reviews.map((review) => (
            <Card key={review.id} className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-ink">
                    Order #{review.orders?.order_number}{' '}
                    <span className="font-normal text-slate-500">
                      · {review.orders?.users?.company_name || review.orders?.users?.email}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {REASON_LABELS[review.reason] || review.reason} · {formatCurrency(review.orders?.total_amount)} ·
                    flagged {formatDate(review.created_at)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => navigate(`/admin/orders/${review.order_id}`)}
                  >
                    View order
                  </Button>
                  {(REASON_ACTIONS[review.reason] || []).map((entry) => (
                    <Button
                      key={entry.action}
                      variant={entry.variant}
                      onClick={() => handleActionClick(review, entry)}
                      disabled={actingId === review.id}
                    >
                      {entry.label}
                    </Button>
                  ))}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {pendingConfirm && (
        <ConfirmDialog
          title={`${pendingConfirm.label}?`}
          message={`This will ${pendingConfirm.label.toLowerCase()} order #${pendingConfirm.orderNumber}. This can't be undone.`}
          confirmLabel={pendingConfirm.label}
          onConfirm={() => handleResolve(pendingConfirm.reviewId, pendingConfirm.action)}
          onCancel={() => setPendingConfirm(null)}
          loading={actingId === pendingConfirm.reviewId}
        />
      )}
    </div>
  );
}

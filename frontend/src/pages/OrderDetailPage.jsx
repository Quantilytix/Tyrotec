import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getOrderById, getOrderStatus, initiatePayfastPayment, submitManualPaymentForReview } from '../api/orders';
import { createPayment } from '../api/payments';
import { formatCurrency, formatDate } from '../utils/formatters';
import { displayTotals, lineTotals, vatRateLabel } from '../utils/vat';
import { downloadReceiptPdf, getReceiptPayment } from '../utils/generateReceiptPdf';
import StatusBadge from '../components/ui/StatusBadge';
import Spinner from '../components/ui/Spinner';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import Card from '../components/ui/Card';
import TotalsSummary from '../components/ui/TotalsSummary';
import PaymentForm from '../components/PaymentForm';
import PayfastRedirectForm from '../components/PayfastRedirectForm';

const POLL_MS = 5000;

// Counts down a plain number of seconds the *server* already computed
// (orderController.js's withReservationSecondsRemaining), rather than
// comparing an absolute expires_at timestamp against this device's own
// clock. That used to show "expired" the instant a reservation was created
// whenever the customer's device clock disagreed with real time (wrong
// timezone, no NTP sync, a phone that's just wrong -- all common) -- ticking
// down a relative number locally is immune to that, since it never needs to
// trust the client's own idea of "now" for anything but counting seconds.
function ReservationCountdown({ secondsRemaining: initialSeconds }) {
  const [secondsLeft, setSecondsLeft] = useState(initialSeconds);

  // Resync whenever the parent hands us a fresh server-computed value
  // (the periodic poll, or a full reload) -- corrects for drift since the
  // last sync instead of just trusting an ever-more-stale local countdown.
  useEffect(() => {
    setSecondsLeft(initialSeconds);
  }, [initialSeconds]);

  useEffect(() => {
    const timer = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, []);

  if (secondsLeft <= 0) return <p className="text-sm text-bad-500">Reservation expired. Refreshing...</p>;

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  return (
    <p className="text-sm text-amber-600">
      Stock reserved. Pay within {minutes}:{String(seconds).padStart(2, '0')} or it releases automatically.
    </p>
  );
}

export default function OrderDetailPage() {
  const { id } = useParams();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [payfastCheckout, setPayfastCheckout] = useState(null);
  const [redirecting, setRedirecting] = useState(false);
  const lastStatus = useRef(null);

  const load = () => getOrderById(id).then(({ data }) => setOrder(data));

  useEffect(() => {
    load().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Only worth polling while something's actually still moving -- once the
  // order settles (confirmed, cancelled, ready, etc.) there's nothing left
  // to catch. GET /orders/:orderId/status is the lean lookup this polls;
  // a full load() only re-runs when the status has actually changed, to
  // pick up the resulting payment/reservation rows.
  useEffect(() => {
    if (!order || order.status !== 'stock_reserved') return undefined;
    lastStatus.current = order.status;

    const interval = setInterval(async () => {
      const { data } = await getOrderStatus(id);
      if (data.status !== lastStatus.current) {
        lastStatus.current = data.status;
        await load();
      }
    }, POLL_MS);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, order?.status]);

  if (loading) return <Spinner />;
  if (!order) return <p className="text-sm text-slate-500">Order not found.</p>;

  // Only one payment can be actively submitted/approved at a time (enforced
  // server-side); a rejected one doesn't block resubmission.
  const activePayment = order.payments?.find((p) => p.status === 'submitted' || p.status === 'approved');
  const latestPayment = order.payments?.length
    ? [...order.payments].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
    : null;
  const isStockReserved = order.status === 'stock_reserved';
  const canSubmitPayment = (order.status === 'approved' || isStockReserved) && !activePayment;
  const reservation = order.stock_reservations?.[0];
  const hasReceipt = Boolean(getReceiptPayment(order));

  const handleSubmitPayment = async (payload) => {
    if (isStockReserved) {
      await submitManualPaymentForReview(order.id, payload);
    } else {
      await createPayment({ order_id: order.id, ...payload });
    }
    setShowPaymentModal(false);
    await load();
  };

  const handlePayfastRetry = async () => {
    setRedirecting(true);
    try {
      const { data } = await initiatePayfastPayment(order.id);
      setPayfastCheckout(data);
    } finally {
      setRedirecting(false);
    }
  };

  if (payfastCheckout) {
    return <PayfastRedirectForm action={payfastCheckout.action} fields={payfastCheckout.fields} />;
  }

  return (
    <div>
      <Link to="/orders" className="text-sm text-teal-600 hover:underline">
        ← Back to orders
      </Link>

      <div className="mt-3 flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">
            Order <span className="font-mono text-base text-slate-400">#{order.order_number}</span>
          </h1>
          <p className="mt-1 text-sm text-slate-500">Placed {formatDate(order.created_at)}</p>
        </div>
        <StatusBadge status={order.status} />
      </div>

      <Card className="mt-6 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3">Unit price (excl. VAT)</th>
              <th className="px-4 py-3">Quantity</th>
              <th className="px-4 py-3">VAT</th>
              <th className="px-4 py-3">Line total (excl. VAT)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {order.order_items?.map((item) => (
              <tr key={item.id}>
                <td className="px-4 py-3">
                  <p className="font-medium text-ink">{item.products?.name}</p>
                  <p className="font-mono text-xs text-slate-400">{item.products?.sku}</p>
                </td>
                <td className="px-4 py-3 font-mono text-ink">{formatCurrency(item.unit_price)}</td>
                <td className="px-4 py-3 text-slate-600">{item.quantity}</td>
                <td className="px-4 py-3 text-slate-600">{vatRateLabel(item.vat_rate)}</td>
                <td className="px-4 py-3 font-mono font-medium text-ink">
                  {formatCurrency(lineTotals(item).net)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {isStockReserved && !activePayment && reservation && (
        <Card className="mt-6 p-4">
          <ReservationCountdown secondsRemaining={reservation.seconds_remaining} />
        </Card>
      )}

      {order.status === 'pending_approval' && (
        <Card className="mt-6 p-4">
          <p className="text-sm text-amber-600">
            Your order is awaiting staff approval. You'll get a notification once it's ready for payment.
          </p>
        </Card>
      )}

      <Card className="mt-6 flex items-center justify-between p-4">
        <TotalsSummary totals={displayTotals(order)} className="text-left" />
        <div className="flex items-center gap-3">
          {latestPayment?.status === 'rejected' && !activePayment && (
            <StatusBadge status="payment_rejected" />
          )}
          {activePayment && <StatusBadge status={`payment_${activePayment.status}`} />}
          {hasReceipt && (
            <Button variant="secondary" onClick={() => downloadReceiptPdf(order)}>
              Download receipt
            </Button>
          )}
          {canSubmitPayment && isStockReserved && (
            <Button variant="secondary" onClick={() => setShowPaymentModal(true)}>
              Pay via bank transfer instead
            </Button>
          )}
          {canSubmitPayment && isStockReserved && (
            <Button onClick={handlePayfastRetry} loading={redirecting}>
              Pay with PayFast
            </Button>
          )}
          {canSubmitPayment && !isStockReserved && (
            <Button onClick={() => setShowPaymentModal(true)}>Submit payment</Button>
          )}
        </div>
      </Card>

      {showPaymentModal && (
        <Modal title="Submit payment" onClose={() => setShowPaymentModal(false)}>
          <PaymentForm
            defaultAmount={order.total_amount}
            onSubmit={handleSubmitPayment}
            onCancel={() => setShowPaymentModal(false)}
          />
        </Modal>
      )}
    </div>
  );
}

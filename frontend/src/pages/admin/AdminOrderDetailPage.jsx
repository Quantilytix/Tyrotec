import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getOrderById, updateOrderStatus } from '../../api/orders';
import { createPayment } from '../../api/payments';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { downloadReceiptPdf, getReceiptPayment } from '../../utils/generateReceiptPdf';
import StatusBadge from '../../components/ui/StatusBadge';
import Spinner from '../../components/ui/Spinner';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Card from '../../components/ui/Card';
import PaymentForm from '../../components/PaymentForm';

// Mirrors the merged transitions map in
// backend/src/services/orderStateService.js -- 'approved' and 'cancelled'
// (from pending_approval) run through the stock-managing RPCs, so the
// backend rejects any other jump (e.g. pending_approval -> completed).
// 'stock_reserved' and 'confirmed' are deliberately absent as *sources*
// here -- those are the fast-checkout path's states, and confirmation only
// ever comes from a verified PayFast webhook, never this dropdown; an order
// sitting in either state shows no manual next-status option at all.
const ORDER_TRANSITIONS = {
  pending_approval: ['approved', 'cancelled'],
  approved: ['processing', 'cancelled'],
  processing: ['completed', 'cancelled'],
  confirmed: ['ready_for_collection', 'cancelled'],
  ready_for_collection: [],
  completed: [],
  cancelled: [],
};

export default function AdminOrderDetailPage() {
  const { id } = useParams();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [nextStatus, setNextStatus] = useState('');
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const load = () =>
    getOrderById(id).then(({ data }) => {
      setOrder(data);
      setNextStatus(data.status);
    });

  useEffect(() => {
    load().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const applyStatusUpdate = async () => {
    setError('');
    setUpdating(true);
    try {
      await updateOrderStatus(id, nextStatus);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not update this order.');
    } finally {
      setUpdating(false);
      setShowCancelConfirm(false);
    }
  };

  // Cancelling restocks/reverses the order and can't be undone from here --
  // worth a confirm step, unlike the other (forward-moving, reversible-by-
  // just-picking-another-status) transitions.
  const handleUpdate = () => {
    if (nextStatus === 'cancelled') {
      setShowCancelConfirm(true);
      return;
    }
    applyStatusUpdate();
  };

  const handleSubmitPayment = async (payload) => {
    await createPayment({ order_id: order.id, ...payload });
    setShowPaymentModal(false);
    await load();
  };

  if (loading) return <Spinner />;
  if (!order) return <p className="text-sm text-slate-500">Order not found.</p>;

  const nextOptions = ORDER_TRANSITIONS[order.status] || [];

  // Only one payment can be actively submitted/approved at a time (enforced
  // server-side); a rejected one doesn't block resubmission -- same rule as
  // the customer's own OrderDetailPage.jsx.
  const activePayment = order.payments?.find((p) => p.status === 'submitted' || p.status === 'approved');
  const latestPayment = order.payments?.length
    ? [...order.payments].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
    : null;
  const canSubmitPayment = ['approved', 'stock_reserved'].includes(order.status) && !activePayment;

  return (
    <div>
      <Link to="/admin/orders" className="text-sm text-teal-600 hover:underline">
        ← Back to orders
      </Link>

      <div className="mt-3 flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">
            Order <span className="font-mono text-base text-slate-400">#{order.order_number}</span>
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {order.customer_id ? (
              <Link to={`/admin/customers/${order.customer_id}`} className="text-teal-600 hover:underline">
                {order.users?.company_name || order.users?.email}
              </Link>
            ) : (
              order.users?.company_name || order.users?.email
            )}{' '}
            · Placed {formatDate(order.created_at)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {latestPayment?.status === 'rejected' && !activePayment && <StatusBadge status="payment_rejected" />}
          {activePayment && <StatusBadge status={`payment_${activePayment.status}`} />}
          <StatusBadge status={order.status} />
        </div>
      </div>

      <Card className="mt-6 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3">Unit price</th>
              <th className="px-4 py-3">Quantity</th>
              <th className="px-4 py-3">Subtotal</th>
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
                <td className="px-4 py-3 font-mono font-medium text-ink">
                  {formatCurrency(item.unit_price * item.quantity)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="mt-6 flex items-center justify-between p-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Total</p>
          <p className="font-mono text-2xl font-semibold text-ink">{formatCurrency(order.total_amount)}</p>
        </div>
        <div className="flex items-center gap-3">
          {error && <p className="text-sm text-bad-500">{error}</p>}
          {getReceiptPayment(order) && (
            <Button variant="secondary" onClick={() => downloadReceiptPdf(order)}>
              Download receipt
            </Button>
          )}
          {canSubmitPayment && <Button onClick={() => setShowPaymentModal(true)}>Submit payment</Button>}
          {nextOptions.length === 0 ? (
            <p className="text-sm text-slate-500">
              {order.status === 'stock_reserved'
                ? 'Awaiting PayFast payment. Moves to "confirmed" automatically once paid.'
                : 'This order is in a final state.'}
            </p>
          ) : (
            <>
              <select
                value={nextStatus}
                onChange={(e) => setNextStatus(e.target.value)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm capitalize outline-none transition-colors duration-150 focus:border-teal-500"
              >
                <option value={order.status}>{order.status.replace(/_/g, ' ')} (current)</option>
                {nextOptions.map((status) => (
                  <option key={status} value={status}>
                    {status.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
              <Button onClick={handleUpdate} loading={updating} disabled={nextStatus === order.status}>
                Update status
              </Button>
            </>
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

      {showCancelConfirm && (
        <ConfirmDialog
          title="Cancel this order?"
          message={`Order #${order.order_number} will be cancelled and any reserved/decremented stock will be restored. This can't be undone.`}
          confirmLabel="Cancel order"
          onConfirm={applyStatusUpdate}
          onCancel={() => setShowCancelConfirm(false)}
          loading={updating}
        />
      )}
    </div>
  );
}

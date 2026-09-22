import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getOrderById, updateOrderStatus } from '../../api/orders';
import { recordPayment } from '../../api/payments';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { displayTotals, lineTotals, vatRateLabel } from '../../utils/vat';
import { downloadReceiptPdf, getReceiptPayment } from '../../utils/generateReceiptPdf';
import StatusBadge from '../../components/ui/StatusBadge';
import Spinner from '../../components/ui/Spinner';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Card from '../../components/ui/Card';
import TotalsSummary from '../../components/ui/TotalsSummary';
import RecordPaymentForm from '../../components/RecordPaymentForm';

// What staff can actually DO to an order right now, in plain words.
//
// This replaced a dropdown listing every legal next status: eight raw
// database values, in two different vocabularies, that a person had to
// translate into "what do I click to move this along". Each entry below is
// one button, and only the buttons that apply to the current status render.
//
// Deliberately absent: anything that moves an order to 'confirmed'. An order
// becomes paid by a verified PayFast payment or by a staff member recording
// one -- never by picking a status. Likewise 'stock_reserved' and
// 'awaiting_payment' are set by checkout, not by anybody here.
const ORDER_ACTIONS = {
  pending_approval: [{ status: 'approved', label: 'Approve order' }],
  processing: [{ status: 'completed', label: 'Mark completed' }],
  confirmed: [{ status: 'ready_for_collection', label: 'Mark ready for collection' }],
  ready_for_collection: [{ status: 'completed', label: 'Mark collected' }],
};

// Every order that hasn't finished can be called off.
const CANCELLABLE = ['pending_approval', 'approved', 'processing', 'stock_reserved', 'awaiting_payment', 'confirmed'];

// Says what the order is waiting on when there's nothing to click.
const WAITING_ON = {
  stock_reserved: 'Waiting for the customer to pay online. Confirms itself once PayFast pays, or record the payment yourself.',
  awaiting_payment: 'To be paid on invoice. Record the payment once it reflects in the bank.',
  approved: 'Waiting for payment. Record it once it reflects in the bank.',
  completed: 'This order is finished.',
  cancelled: 'This order was cancelled.',
};

export default function AdminOrderDetailPage() {
  const { id } = useParams();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [pendingStatus, setPendingStatus] = useState(null);

  const load = () => getOrderById(id).then(({ data }) => setOrder(data));

  useEffect(() => {
    load().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const applyStatusUpdate = async (status) => {
    setError('');
    setUpdating(true);
    try {
      await updateOrderStatus(id, status);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not update this order.');
    } finally {
      setUpdating(false);
      setShowCancelConfirm(false);
      setPendingStatus(null);
    }
  };

  // Cancelling restocks/reverses the order and can't be undone from here --
  // worth a confirm step, unlike the other (forward-moving) actions.
  const handleCancel = () => {
    setPendingStatus('cancelled');
    setShowCancelConfirm(true);
  };

  // Records money already verified in the bank: the order is marked paid and
  // the customer notified by the same call, so a reload here shows it
  // confirmed with a receipt ready.
  const handleRecordPayment = async (payload) => {
    await recordPayment({ order_id: order.id, ...payload });
    setShowPaymentModal(false);
    await load();
  };

  if (loading) return <Spinner />;
  if (!order) return <p className="text-sm text-slate-500">Order not found.</p>;

  const actions = ORDER_ACTIONS[order.status] || [];
  const canCancel = CANCELLABLE.includes(order.status);

  // Only one payment can be actively submitted/approved at a time (enforced
  // server-side); a rejected one doesn't block resubmission -- same rule as
  // the customer's own OrderDetailPage.jsx.
  const activePayment = order.payments?.find((p) => p.status === 'submitted' || p.status === 'approved');
  const latestPayment = order.payments?.length
    ? [...order.payments].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
    : null;
  const canRecordPayment =
    ['approved', 'stock_reserved', 'awaiting_payment'].includes(order.status) && !activePayment;

  return (
    <div>
      <Link to="/admin/orders" className="text-sm text-teal-600 hover:underline">
        ← Back to orders
      </Link>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
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

      <Card className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
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

      <Card className="mt-6 flex flex-col gap-4 p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <TotalsSummary totals={displayTotals(order)} className="text-left" />
        <div className="flex items-center gap-3">
          {error && <p className="text-sm text-bad-500">{error}</p>}
          {getReceiptPayment(order) && (
            <Button variant="secondary" onClick={() => downloadReceiptPdf(order)}>
              Download receipt
            </Button>
          )}
          {canRecordPayment && <Button onClick={() => setShowPaymentModal(true)}>Record payment</Button>}
          {actions.map((action) => (
            <Button
              key={action.status}
              onClick={() => applyStatusUpdate(action.status)}
              loading={updating && pendingStatus === null}
            >
              {action.label}
            </Button>
          ))}
          {canCancel && (
            <Button variant="danger" onClick={handleCancel} disabled={updating}>
              Cancel order
            </Button>
          )}
          {actions.length === 0 && !canRecordPayment && WAITING_ON[order.status] && (
            <p className="max-w-sm text-right text-sm text-slate-500">{WAITING_ON[order.status]}</p>
          )}
        </div>
      </Card>

      {showPaymentModal && (
        <Modal title="Record a payment" onClose={() => setShowPaymentModal(false)}>
          <RecordPaymentForm
            defaultAmount={order.total_amount}
            orderNumber={order.order_number}
            onSubmit={handleRecordPayment}
            onCancel={() => setShowPaymentModal(false)}
          />
        </Modal>
      )}

      {showCancelConfirm && (
        <ConfirmDialog
          title="Cancel this order?"
          message={`Order #${order.order_number} will be cancelled and any reserved/decremented stock will be restored. This can't be undone.`}
          confirmLabel="Cancel order"
          onConfirm={() => applyStatusUpdate('cancelled')}
          onCancel={() => setShowCancelConfirm(false)}
          loading={updating}
        />
      )}
    </div>
  );
}

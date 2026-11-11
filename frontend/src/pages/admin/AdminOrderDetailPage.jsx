import { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { getOrderById, updateOrderStatus, setOrderStockEta, downloadInvoicePdf, emailInvoice } from '../../api/orders';
import { recordPayment } from '../../api/payments';
import { formatCurrency, formatDate, formatDay } from '../../utils/formatters';
import { longestLeadTime } from '../../utils/availability';
import { displayTotals, lineTotals, vatRateLabel } from '../../utils/vat';
import { downloadReceiptPdf, getReceiptPayment } from '../../utils/generateReceiptPdf';
import { saveBlobResponse, blobErrorMessage } from '../../utils/downloadFile';
import { invoiceLabel, isInvoice, saleTitle } from '../../utils/invoiceNumber';
import StatusBadge from '../../components/ui/StatusBadge';
import { orderDisplayStatus, matchesStatusGroup, PAYMENT_BADGE_LABELS } from '../../utils/statusLabels';
import Spinner from '../../components/ui/Spinner';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Card from '../../components/ui/Card';
import TotalsSummary from '../../components/ui/TotalsSummary';
import DiscountNote from '../../components/ui/DiscountNote';
import RecordPaymentForm from '../../components/RecordPaymentForm';
import ReceiveStockForm from '../../components/admin/ReceiveStockForm';
import ActionMenu from '../../components/ui/ActionMenu';
import { CANCELLABLE, activePaymentOf, canRecordPayment as canTakePayment, shortLinesOf, statusMovesFor } from '../../utils/orderActions';

// ?action= from the Orders/Invoices lists' Actions menu: open that form.
const LINKED_ACTIONS = ['record-payment', 'receive-stock'];

// An order waiting for stock: which lines are short, when staff told the
// customer it should arrive, and a box to tell them (again). The order is
// approved automatically, oldest first, once stock covers every line.
// paid: the customer paid while it waited, so approving it marks it paid.
function WaitingForStockCard({ order, shortLines, paid, onSaved }) {
  const [days, setDays] = useState(String(longestLeadTime(shortLines.map((l) => l.products)) || ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setError('');
    setSaving(true);
    try {
      await setOrderStockEta(order.id, Number(days));
      await onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save the arrival date.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mt-6 p-4">
      <p className="font-medium text-ink">Waiting for stock</p>
      <ul className="mt-2 space-y-1 text-sm text-slate-600">
        {shortLines.map((line) => (
          <li key={line.id}>
            {line.products.name}: needs {line.quantity}, {line.products.stock_quantity} in stock
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm text-slate-500">
        {order.stock_expected_at
          ? `Customer told to expect it around ${formatDay(order.stock_expected_at)}.`
          : 'The customer has not been told when to expect it yet.'}{' '}
        {paid
          ? "It's already paid, and is approved and marked as paid automatically once the stock is in."
          : "It's approved automatically once the stock is in, and the customer then has 3 days to pay."}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="stock-eta-days" className="text-sm text-slate-600">
          Arrives in
        </label>
        <input
          id="stock-eta-days"
          type="number"
          min={0}
          max={365}
          value={days}
          onChange={(e) => setDays(e.target.value)}
          className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-sm outline-none transition-colors duration-150 focus:border-teal-500"
        />
        <span className="text-sm text-slate-600">days</span>
        <Button onClick={save} loading={saving} disabled={days === '' || Number(days) < 0}>
          Tell the customer
        </Button>
        {error && <p className="text-sm text-bad-500">{error}</p>}
      </div>
    </Card>
  );
}

// Says what the order is waiting on when there's nothing to click.
const WAITING_ON = {
  stock_reserved: 'Waiting for the customer to pay online. Confirms itself once Paystack confirms the payment, or record the payment yourself.',
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
  const [sending, setSending] = useState(false);
  const [sentNote, setSentNote] = useState('');
  const [showReceiveStock, setShowReceiveStock] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const load = () => getOrderById(id).then(({ data }) => setOrder(data));

  useEffect(() => {
    load().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Arrived from a list's Actions menu: open the form it asked for, once.
  const linkedAction = searchParams.get('action');
  useEffect(() => {
    if (!order || !LINKED_ACTIONS.includes(linkedAction)) return;
    if (linkedAction === 'record-payment' && canTakePayment(order)) setShowPaymentModal(true);
    if (linkedAction === 'receive-stock' && shortLinesOf(order).length > 0) setShowReceiveStock(true);
    setSearchParams({}, { replace: true });
  }, [order, linkedAction, setSearchParams]);

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

  const handleDownloadInvoice = async () => {
    setError('');
    try {
      saveBlobResponse(await downloadInvoicePdf(order.id), `${invoiceLabel(order.invoice_number)}.pdf`);
    } catch (err) {
      setError(await blobErrorMessage(err, 'Could not download the invoice.'));
    }
  };

  const handleEmailInvoice = async () => {
    setError('');
    setSentNote('');
    setSending(true);
    try {
      const { data } = await emailInvoice(order.id);
      setSentNote(`Invoice emailed to ${data.to}.`);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not email the invoice.');
    } finally {
      setSending(false);
    }
  };

  if (loading) return <Spinner />;
  if (!order) return <p className="text-sm text-slate-500">Order not found.</p>;

  // Staff-made sales are invoices (INV- number): same order underneath.
  const invoice = isInvoice(order);
  const title = saleTitle(order);
  // In Recently deleted (046): look, don't touch -- restore it first.
  const inBin = Boolean(order.deleted_at);
  const canCancel = !inBin && CANCELLABLE.includes(order.status);

  // Only one payment can be actively submitted/approved at a time (enforced
  // server-side); a rejected one doesn't block resubmission -- same rule as
  // the customer's own OrderDetailPage.jsx.
  const activePayment = activePaymentOf(order);
  const displayStatus = orderDisplayStatus(order);
  const latestPayment = order.payments?.length
    ? [...order.payments].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
    : null;
  const canRecordPayment = !inBin && canTakePayment(order);
  const shortLines = shortLinesOf(order);
  // The status steps open now, plus "Stock received" for an order short of
  // stock (approving it would only fail until the stock is in).
  const statusItems = [
    ...statusMovesFor(order).map((move) => ({ label: move.label, onClick: () => applyStatusUpdate(move.status) })),
    { label: 'Stock received…', onClick: () => setShowReceiveStock(true), hidden: shortLines.length === 0 },
  ];
  const hasStatusItems = !inBin && statusItems.some((item) => !item.hidden);

  return (
    <div>
      <Link to={invoice ? '/admin/invoices' : '/admin/orders'} className="text-sm text-teal-600 hover:underline">
        ← Back to {invoice ? 'invoices' : 'orders'}
      </Link>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">
            {invoice ? 'Invoice' : 'Order'}{' '}
            <span className="font-mono text-base text-slate-400">
              {invoice ? invoiceLabel(order.invoice_number) : `#${order.order_number}`}
            </span>
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {order.customer_id ? (
              <Link to={`/admin/customers/${order.customer_id}`} className="text-teal-600 hover:underline">
                {order.users?.company_name || order.users?.email}
              </Link>
            ) : (
              order.users?.company_name || order.users?.email
            )}{' '}
            · {invoice ? 'Made' : 'Placed'} {formatDate(order.created_at)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {['rejected', 'cancelled'].includes(latestPayment?.status) && !activePayment && (
            <StatusBadge status={`payment_${latestPayment.status}`} label={PAYMENT_BADGE_LABELS[latestPayment.status]} />
          )}
          {/* Not when the order's own badge already says it's paid. */}
          {activePayment && !matchesStatusGroup('paid', displayStatus) && (
            <StatusBadge status={`payment_${activePayment.status}`} label={PAYMENT_BADGE_LABELS[activePayment.status]} />
          )}
          <StatusBadge status={displayStatus} />
        </div>
      </div>

      {inBin && (
        <p className="mt-4 rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-500">
          This {invoice ? 'invoice' : 'order'} is in{' '}
          <Link to="/admin/recently-deleted" className="font-medium underline">
            Recently deleted
          </Link>
          . Restore it there to work on it again.
        </p>
      )}

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
                  <DiscountNote line={item} />
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

      {shortLines.length > 0 && (
        <WaitingForStockCard order={order} shortLines={shortLines} paid={Boolean(activePayment)} onSaved={load} />
      )}

      {order.status === 'approved' && order.payment_due_at && !activePayment && (
        <Card className="mt-6 p-4">
          <p className="text-sm text-slate-600">
            Payment due by {formatDate(order.payment_due_at)}. If it isn't paid by then, the order is cancelled
            automatically and its stock goes to the next waiting customer.
          </p>
        </Card>
      )}

      <Card className="mt-6 flex flex-col gap-4 p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <TotalsSummary totals={displayTotals(order)} className="text-left" />
        <div className="flex flex-wrap items-center gap-3">
          {error && <p className="text-sm text-bad-500">{error}</p>}
          {sentNote && <p className="text-sm text-good-500">{sentNote}</p>}
          {invoice && (
            <>
              <Button variant="secondary" onClick={handleDownloadInvoice}>
                Download invoice
              </Button>
              {order.status !== 'cancelled' && (
                <Button variant="secondary" onClick={handleEmailInvoice} loading={sending}>
                  Email to customer
                </Button>
              )}
            </>
          )}
          {getReceiptPayment(order) && (
            <Button variant="secondary" onClick={() => downloadReceiptPdf(order)}>
              Download receipt
            </Button>
          )}
          {canRecordPayment && <Button onClick={() => setShowPaymentModal(true)}>Record payment</Button>}
          {hasStatusItems &&
            (updating && pendingStatus === null ? (
              <Button loading>Updating…</Button>
            ) : (
              <ActionMenu label="Update status" variant="primary" size="md" items={statusItems} />
            ))}
          {canCancel && (
            <Button variant="danger" onClick={handleCancel} disabled={updating}>
              Cancel {invoice ? 'invoice' : 'order'}
            </Button>
          )}
          {!hasStatusItems && !canRecordPayment && WAITING_ON[order.status] && (
            <p className="max-w-sm text-right text-sm text-slate-500">{WAITING_ON[order.status]}</p>
          )}
        </div>
      </Card>

      {showPaymentModal && (
        <Modal title="Record a payment" onClose={() => setShowPaymentModal(false)}>
          <RecordPaymentForm
            defaultAmount={order.total_amount}
            saleName={title}
            waitingForStock={shortLines.length > 0}
            onSubmit={handleRecordPayment}
            onCancel={() => setShowPaymentModal(false)}
          />
        </Modal>
      )}

      {showReceiveStock && (
        <Modal title="Stock received" onClose={() => setShowReceiveStock(false)}>
          <ReceiveStockForm
            order={order}
            shortLines={shortLines}
            saleName={title}
            paid={Boolean(activePayment)}
            onDone={async () => {
              setShowReceiveStock(false);
              await load();
            }}
            onCancel={() => setShowReceiveStock(false)}
          />
        </Modal>
      )}

      {showCancelConfirm && (
        <ConfirmDialog
          title={`Cancel this ${invoice ? 'invoice' : 'order'}?`}
          message={
            activePayment
              ? `${title} will be cancelled, its payment marked cancelled (not paid) and any reserved/decremented stock restored. Refund the customer separately. This can't be undone.`
              : `${title} will be cancelled and any reserved/decremented stock will be restored. This can't be undone.`
          }
          confirmLabel={`Cancel ${invoice ? 'invoice' : 'order'}`}
          onConfirm={() => applyStatusUpdate('cancelled')}
          onCancel={() => setShowCancelConfirm(false)}
          loading={updating}
        />
      )}
    </div>
  );
}

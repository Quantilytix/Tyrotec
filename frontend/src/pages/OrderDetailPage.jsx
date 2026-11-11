import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  getOrderById,
  getOrderStatus,
  startOnlinePayment,
  confirmOnlinePayment,
  payOrderOnInvoice,
  downloadInvoicePdf,
} from '../api/orders';
import { saveBlobResponse, blobErrorMessage } from '../utils/downloadFile';
import { invoiceLabel, isInvoice, saleTitle } from '../utils/invoiceNumber';
import { COMPANY } from '../utils/pdfShared';
import { formatCurrency, formatDate, formatDay } from '../utils/formatters';
import { availabilityNote, longestLeadTime } from '../utils/availability';
import { displayTotals, lineTotals, vatRateLabel } from '../utils/vat';
import { downloadReceiptPdf, getReceiptPayment } from '../utils/generateReceiptPdf';
import StatusBadge from '../components/ui/StatusBadge';
import { orderDisplayStatus, PAYMENT_BADGE_LABELS } from '../utils/statusLabels';
import Spinner from '../components/ui/Spinner';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import TotalsSummary from '../components/ui/TotalsSummary';
import DiscountNote from '../components/ui/DiscountNote';

const POLL_MS = 5000;

// What the customer sees on landing back from Paystack, by what the API
// found when it asked Paystack.
const RETURN_NOTES = {
  paid: { tone: 'good', text: 'Payment received, thank you. Your receipt is ready below.' },
  needs_review: {
    tone: 'warn',
    text: "We've received your payment and our team is checking it. We'll be in touch if anything is needed.",
  },
  not_paid: { tone: 'bad', text: "The payment wasn't completed, so nothing was taken. You can try Pay now again." },
  unknown: {
    tone: 'warn',
    text: "We're waiting for Paystack to confirm your payment. Refresh this page in a minute or two.",
  },
};
const NOTE_STYLES = {
  good: 'bg-good-50 text-good-500',
  warn: 'bg-amber-50 text-amber-700',
  bad: 'bg-bad-50 text-bad-500',
};

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
  const { user } = useAuth();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [returnNote, setReturnNote] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const paystackReference = searchParams.get('reference');
  const [redirecting, setRedirecting] = useState(false);
  const [switchingToInvoice, setSwitchingToInvoice] = useState(false);
  const [error, setError] = useState('');
  const lastStatus = useRef(null);

  const load = () => getOrderById(id).then(({ data }) => setOrder(data));

  useEffect(() => {
    load().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Back from Paystack: it adds ?reference=... to this page. Ask the API to
  // check that payment with Paystack, then show the result and reload.
  useEffect(() => {
    if (!paystackReference) return;
    setSearchParams({}, { replace: true });
    confirmOnlinePayment(id, paystackReference)
      .then(({ data }) => setReturnNote(RETURN_NOTES[data.outcome] || RETURN_NOTES.unknown))
      .catch(() => setReturnNote(RETURN_NOTES.unknown))
      .finally(() => load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, paystackReference]);

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
  const isApproved = order.status === 'approved';
  // Made by staff from a quote: a tax invoice (INV- number), same order underneath.
  const invoice = isInvoice(order);
  // Paystack is how a customer pays themselves, for anything with its stock
  // set aside: reserved at checkout, approved (by staff, or when stock the
  // order was waiting for arrived), or invoiced and waiting for payment.
  // These can also be paid by EFT, which staff record.
  const isOnAccount = order.status === 'awaiting_payment';
  const canPayOnline = (isStockReserved || isApproved || isOnAccount) && !activePayment;
  const awaitingOfflinePayment = isOnAccount && !activePayment;
  // An order waiting for approval because some items aren't in stock.
  const shortLines = (order.order_items || [])
    .filter((item) => item.products && item.quantity > item.products.stock_quantity)
    .map((item) => item.products);
  const waitingForStock = order.status === 'pending_approval' && shortLines.length > 0;
  const reservation = order.stock_reservations?.[0];
  const hasReceipt = Boolean(getReceiptPayment(order));

  // Offered here rather than at checkout: everyone takes the same route to
  // get an order, and only an approved account then chooses to be invoiced
  // instead of paying online.
  const handleDownloadInvoice = async () => {
    setError('');
    try {
      saveBlobResponse(await downloadInvoicePdf(order.id), `${invoiceLabel(order.invoice_number)}.pdf`);
    } catch (err) {
      setError(await blobErrorMessage(err, 'Could not download the invoice.'));
    }
  };

  const handlePayOnInvoice = async () => {
    setError('');
    setSwitchingToInvoice(true);
    try {
      await payOrderOnInvoice(order.id);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not switch this order to an invoice.');
    } finally {
      setSwitchingToInvoice(false);
    }
  };

  // Off to Paystack's payment page; it sends the customer back here.
  const handlePayOnline = async () => {
    setError('');
    setReturnNote(null);
    setRedirecting(true);
    try {
      const { data } = await startOnlinePayment(order.id);
      window.location.assign(data.url);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not start the payment. Please try again.');
      setRedirecting(false);
    }
  };

  return (
    <div>
      <Link to="/orders" className="text-sm text-teal-600 hover:underline">
        ← Back to orders
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
            {invoice ? 'Made' : 'Placed'} {formatDate(order.created_at)}
          </p>
        </div>
        <StatusBadge status={orderDisplayStatus(order)} />
      </div>

      {returnNote && (
        <p className={`mt-4 rounded-lg px-3 py-2 text-sm ${NOTE_STYLES[returnNote.tone]}`}>{returnNote.text}</p>
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
                  {order.status === 'pending_approval' && item.products && availabilityNote(item.products.stock_quantity, item.quantity, item.products.lead_time_days) && (
                    <p className="mt-1 text-xs text-amber-600">
                      {availabilityNote(item.products.stock_quantity, item.quantity, item.products.lead_time_days)}
                    </p>
                  )}
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
            {waitingForStock
              ? `Some items on this order aren't in stock yet. ${
                  order.stock_expected_at
                    ? `They're expected around ${formatDay(order.stock_expected_at)}.`
                    : `They usually take about ${longestLeadTime(shortLines)} ${
                        longestLeadTime(shortLines) === 1 ? 'day' : 'days'
                      } to arrive.`
                } We'll let you know as soon as they arrive${activePayment ? '. Your payment has been received.' : ', and you pay then.'}`
              : activePayment
                ? 'Your payment has been received. Your order is awaiting staff approval.'
                : "Your order is awaiting staff approval. You'll get a notification once it's ready for payment."}
          </p>
        </Card>
      )}

      {isApproved && !activePayment && (
        <Card className="mt-6 p-4">
          <p className="text-sm text-slate-600">
            {invoice
              ? `${saleTitle(order)} is ready and its stock is set aside. Choose Pay now to pay online with Paystack, or pay by EFT using ${invoiceLabel(order.invoice_number)} as the reference`
              : 'Your order is approved and its stock is set aside. Choose Pay now to pay online with Paystack'}
            {order.payment_due_at
              ? `. Please pay by ${formatDate(order.payment_due_at)}: after that the stock goes to the next customer.`
              : '.'}
          </p>
        </Card>
      )}

      {invoice && (isApproved || order.status === 'awaiting_payment') && !activePayment && (
        <Card className="mt-6 p-4">
          <p className="font-medium text-ink">Pay by EFT</p>
          <ul className="mt-2 space-y-0.5 text-sm text-slate-600">
            {COMPANY.bankDetails.map((line) => (
              <li key={line}>{line}</li>
            ))}
            <li>
              Reference: <span className="font-mono font-medium text-ink">{invoiceLabel(order.invoice_number)}</span>
            </li>
          </ul>
          <p className="mt-2 text-xs text-slate-500">
            Your receipt appears here once the payment reflects in our account.
          </p>
        </Card>
      )}

      {awaitingOfflinePayment && (
        <Card className="mt-6 p-4">
          <p className="text-sm text-slate-600">
            This order is placed on account and your stock is set aside. Choose Pay now to pay online, or pay by
            EFT — your receipt appears here as soon as it reflects.
          </p>
        </Card>
      )}

      <Card className="mt-6 flex flex-col gap-4 p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <TotalsSummary totals={displayTotals(order)} className="text-left" />
        <div className="flex items-center gap-3">
          {['rejected', 'cancelled'].includes(latestPayment?.status) && !activePayment && (
            <StatusBadge status={`payment_${latestPayment.status}`} label={PAYMENT_BADGE_LABELS[latestPayment.status]} />
          )}
          {activePayment && (
            <StatusBadge status={`payment_${activePayment.status}`} label={PAYMENT_BADGE_LABELS[activePayment.status]} />
          )}
          {invoice && (
            <Button variant="secondary" onClick={handleDownloadInvoice}>
              Download invoice
            </Button>
          )}
          {hasReceipt && (
            <Button variant="secondary" onClick={() => downloadReceiptPdf(order)}>
              Download receipt
            </Button>
          )}
          {error && <p className="text-sm text-bad-500">{error}</p>}
          {/* An invoice is already invoiced: paying by EFT needs no switch. */}
          {canPayOnline && !isOnAccount && user?.can_order_on_account && !invoice && (
            <Button
              variant="secondary"
              onClick={handlePayOnInvoice}
              loading={switchingToInvoice}
              disabled={redirecting}
            >
              Pay on invoice
            </Button>
          )}
          {canPayOnline && (
            <Button onClick={handlePayOnline} loading={redirecting} disabled={switchingToInvoice}>
              Pay now
            </Button>
          )}
        </div>
      </Card>

    </div>
  );
}

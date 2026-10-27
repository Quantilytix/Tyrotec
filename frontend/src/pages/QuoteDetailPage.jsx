import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getQuoteById, checkoutQuoteFast, refreshQuote } from '../api/quotes';
import DiscountNote from '../components/ui/DiscountNote';
import QuoteItemsEditor from '../components/QuoteItemsEditor';
import { useAuth } from '../context/AuthContext';
import { formatCurrency, formatDate } from '../utils/formatters';
import { displayTotals, lineTotals, vatRateLabel } from '../utils/vat';
import { downloadQuotePdf } from '../utils/generateQuotePdf';
import { availabilityNote } from '../utils/availability';
import StatusBadge from '../components/ui/StatusBadge';
import Spinner from '../components/ui/Spinner';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import TotalsSummary from '../components/ui/TotalsSummary';

export default function QuoteDetailPage() {
  const { quoteId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);

  const load = () => getQuoteById(quoteId).then(({ data }) => setQuote(data));

  useEffect(() => {
    setEditing(false);
    load().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteId]);

  // The customer's one action on a quote. Stock is checked and reserved
  // immediately so nobody buys it out from under them, then they land on the
  // order page -- payment is always a separate, explicit step taken there,
  // never auto-triggered here. If stock is short the order is still created,
  // falling back to the staff-approval queue; that's the system's decision,
  // not something the customer should have to understand or choose.
  // A discount this quote was priced with has ended: a new quote for the
  // same products at today's prices replaces it.
  const handleRefresh = async () => {
    setError('');
    setRefreshing(true);
    try {
      const { data } = await refreshQuote(quoteId);
      navigate(`/quotes/${data.quoteId}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not update this quote.');
    } finally {
      setRefreshing(false);
    }
  };

  const handleFastCheckout = async () => {
    setError('');
    setCheckingOut(true);
    try {
      const { data } = await checkoutQuoteFast(quoteId);
      navigate(`/orders/${data.orderId}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not place this order.');
      setCheckingOut(false);
    }
  };

  if (loading) return <Spinner />;
  if (!quote) return <p className="text-sm text-slate-500">Quote not found.</p>;

  const discountEnded = quote.quote_items?.some((item) => item.discount_ended);
  const canConvert = quote.status === 'submitted' && !discountEnded;
  // Changeable until it's ordered (or expires).
  const canEdit = ['draft', 'submitted'].includes(quote.status);
  const hasShortItems = quote.quote_items?.some(
    (item) => item.products && availabilityNote(item.products.stock_quantity, item.quantity, item.products.lead_time_days)
  );

  const handleDownload = () => {
    downloadQuotePdf({
      items: quote.quote_items.map((item) => ({
        name: item.products?.name,
        sku: item.products?.sku,
        unit_price: item.unit_price,
        list_price: item.list_price,
        discount_percent: item.discount_percent,
        discount_reason: item.discount_reason,
        quantity: item.quantity,
        vat_rate: item.vat_rate,
      })),
      totals: displayTotals(quote),
      customer: user,
      quoteNumber: quote.quote_number,
      status: quote.status,
      createdAt: quote.created_at,
    });
  };

  return (
    <div>
      <Link to="/quotes" className="text-sm text-teal-600 hover:underline">
        ← Back to quotes
      </Link>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">
            Quote <span className="font-mono text-base text-slate-400">#{quote.quote_number}</span>
          </h1>
          <p className="mt-1 text-sm text-slate-500">Submitted {formatDate(quote.created_at)}</p>
        </div>
        <StatusBadge status={quote.status} />
      </div>

      {editing ? (
        <QuoteItemsEditor
          quote={quote}
          onSaved={async () => {
            await load();
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
      <>
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
            {quote.quote_items?.map((item) => (
              <tr key={item.id}>
                <td className="px-4 py-3">
                  <p className="font-medium text-ink">{item.products?.name}</p>
                  <p className="font-mono text-xs text-slate-400">{item.products?.sku}</p>
                  <DiscountNote line={item} />
                  {item.discount_ended && <p className="mt-1 text-xs text-bad-500">This discount has ended.</p>}
                  {item.products && availabilityNote(item.products.stock_quantity, item.quantity, item.products.lead_time_days) && (
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

      {quote.status === 'submitted' && discountEnded && (
        <Card className="mt-6 flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-bad-500">
            A discount on this quote has ended, so its prices no longer apply. Get an updated quote at today's prices
            to order.
          </p>
          <Button onClick={handleRefresh} loading={refreshing}>
            Get an updated quote
          </Button>
        </Card>
      )}

      {canConvert && hasShortItems && (
        <Card className="mt-6 p-4">
          <p className="text-sm text-amber-600">
            Some items aren't in stock right now. You can still accept: your order waits until they arrive, we'll let
            you know when they do, and you pay then.
          </p>
        </Card>
      )}

      <Card className="mt-6 flex flex-col gap-4 p-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <TotalsSummary totals={displayTotals(quote)} className="text-left" />
        <div className="flex items-center gap-3">
          {error && <p className="text-sm text-bad-500">{error}</p>}
          <button
            type="button"
            onClick={handleDownload}
            className="text-sm text-teal-600 transition-colors duration-150 hover:underline"
          >
            Download PDF
          </button>
          {canEdit && (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit quote
            </Button>
          )}
          {canConvert && (
            <Button onClick={handleFastCheckout} loading={checkingOut}>
              Accept &amp; order
            </Button>
          )}
          {quote.status === 'converted' && (
            <p className="text-sm text-slate-500">This quote has already been converted to an order.</p>
          )}
          {quote.status === 'expired' && (
            <p className="text-sm text-slate-500">This quote has expired and can no longer be converted.</p>
          )}
        </div>
      </Card>
      </>
      )}
    </div>
  );
}

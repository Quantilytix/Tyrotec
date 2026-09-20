import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { createQuote, checkoutQuoteFast } from '../api/quotes';
import { formatCurrency } from '../utils/formatters';
import { lineTotals, vatRateLabel } from '../utils/vat';
import { downloadQuotePdf } from '../utils/generateQuotePdf';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import Card from '../components/ui/Card';
import TotalsSummary from '../components/ui/TotalsSummary';

export default function CartPage() {
  const { items, updateQuantity, removeItem, clearCart, totals } = useCart();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [buyingNow, setBuyingNow] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setError('');
    setSubmitting(true);
    try {
      const payload = items.map((i) => ({ product_id: i.product_id, quantity: i.quantity }));
      const { data } = await createQuote(payload);
      clearCart();
      navigate(`/quotes/${data.quoteId}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save the quote. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Collapses "save a quote, open it, click Checkout now" into one step for
  // the common case (everything's in stock, no need for a formal quote) --
  // same two backend calls QuoteDetailPage's "Checkout now" button makes
  // (createQuote then checkoutQuoteFast), just chained here instead of
  // requiring a detour through the quote detail page first. If stock turns
  // out to be short, checkoutQuoteFast still creates the order (falling back
  // to pending_approval) rather than failing, so this always lands on a real
  // order page one way or another.
  const handleBuyNow = async () => {
    setError('');
    setBuyingNow(true);
    try {
      const payload = items.map((i) => ({ product_id: i.product_id, quantity: i.quantity }));
      const { data: quoteData } = await createQuote(payload);
      const { data: orderData } = await checkoutQuoteFast(quoteData.quoteId);
      clearCart();
      navigate(`/orders/${orderData.orderId}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not complete checkout. Try again.');
    } finally {
      setBuyingNow(false);
    }
  };

  const handleDownload = () => {
    downloadQuotePdf({ items, totals, customer: user });
  };

  if (items.length === 0) {
    return (
      <EmptyState
        title="Your quote is empty"
        description="Add products from the catalog to start building a quote."
        action={
          <Link to="/products">
            <Button>Browse products</Button>
          </Link>
        }
      />
    );
  }

  return (
    <div>
      <h1 className="font-display text-xl font-semibold text-ink">Quote builder</h1>
      <p className="mt-1 text-sm text-slate-500">Review your items, then buy now or save a formal quote for later.</p>

      <Card className="mt-6 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3">Unit price (excl. VAT)</th>
              <th className="px-4 py-3">Quantity</th>
              <th className="px-4 py-3">VAT</th>
              <th className="px-4 py-3">Line total (excl. VAT)</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item) => (
              <tr key={item.product_id}>
                <td className="px-4 py-3">
                  <p className="font-medium text-ink">{item.name}</p>
                  <p className="font-mono text-xs text-slate-400">{item.sku}</p>
                </td>
                <td className="px-4 py-3 font-mono text-ink">{formatCurrency(item.unit_price)}</td>
                <td className="px-4 py-3">
                  <input
                    type="number"
                    min={1}
                    value={item.quantity}
                    onChange={(e) =>
                      updateQuantity(item.product_id, Math.max(Number(e.target.value), 1))
                    }
                    className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-sm outline-none transition-colors duration-150 focus:border-teal-500"
                  />
                </td>
                <td className="px-4 py-3 text-slate-600">{vatRateLabel(item.vat_rate)}</td>
                <td className="px-4 py-3 font-mono font-medium text-ink">
                  {formatCurrency(lineTotals(item).net)}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => removeItem(item.product_id)}
                    className="text-xs font-medium text-bad-500 transition-colors duration-150 hover:underline"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="mt-6 flex flex-wrap items-center justify-between gap-4 p-4">
        <TotalsSummary totals={totals} className="text-left" />
        <div className="flex items-center gap-3">
          {error && <p className="text-sm text-bad-500">{error}</p>}
          <Button variant="secondary" onClick={clearCart} disabled={submitting || buyingNow}>
            Clear
          </Button>
          <Button variant="secondary" onClick={handleDownload} disabled={submitting || buyingNow}>
            Download quote
          </Button>
          <div className="flex flex-col items-center gap-1">
            <Button variant="secondary" onClick={handleSubmit} loading={submitting} disabled={buyingNow}>
              Finalize quote
            </Button>
            <p className="max-w-[10rem] text-center text-xs text-slate-400">
              Saves it for later. Convert or check out from the quote page
            </p>
          </div>
          <div className="flex flex-col items-center gap-1">
            <Button onClick={handleBuyNow} loading={buyingNow} disabled={submitting}>
              Buy now
            </Button>
            <p className="max-w-[10rem] text-center text-xs text-slate-400">
              Stock reserved immediately, pay by card or EFT right away
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { createQuote } from '../api/quotes';
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
      <p className="mt-1 text-sm text-slate-500">
        Review your items, then request a quote. You confirm the order from the quote.
      </p>

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
          <button
            type="button"
            onClick={clearCart}
            disabled={submitting}
            className="text-sm text-slate-500 transition-colors duration-150 hover:text-ink disabled:opacity-50"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={submitting}
            className="text-sm text-teal-600 transition-colors duration-150 hover:underline disabled:opacity-50"
          >
            Download PDF
          </button>
          <Button onClick={handleSubmit} loading={submitting}>
            Request quote
          </Button>
        </div>
      </Card>
    </div>
  );
}

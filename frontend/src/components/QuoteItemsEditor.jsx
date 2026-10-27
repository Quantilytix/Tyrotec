import { useEffect, useState } from 'react';
import { getProducts } from '../api/products';
import { editQuoteItems } from '../api/quotes';
import { formatCurrency } from '../utils/formatters';
import Button from './ui/Button';
import Card from './ui/Card';

const INPUT =
  'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-teal-500';

// Edits a quote's products and quantities before it's ordered: change a
// quantity, remove a line, search for a product to add. Used on the
// customer's quote page and the admin one. Prices aren't edited here: the
// server prices every line again from today's catalogue when it's saved
// (backend quoteService.js's updateQuoteItems).
// staff: show a Discount % per line and a reason (staff quotes only; the
// server ignores discounts a customer sends, and keeps staff ones on their edits).
export default function QuoteItemsEditor({ quote, onSaved, onCancel, staff = false }) {
  const [lines, setLines] = useState(() =>
    (quote.quote_items || []).map((item) => ({
      product_id: item.product_id,
      name: item.products?.name || 'Product',
      sku: item.products?.sku || '',
      quantity: item.quantity,
      // A staff discount already on the line (not a catalogue one).
      discount_percent: !item.discount_id && item.discount_percent ? String(Number(item.discount_percent)) : '',
    }))
  );
  const [discountReason, setDiscountReason] = useState(
    () => (quote.quote_items || []).find((i) => !i.discount_id && i.discount_percent)?.discount_reason || ''
  );
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return undefined;
    }
    const timeout = setTimeout(() => {
      getProducts({ search: query, limit: 8 })
        .then(({ data }) => setResults(data.data))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(timeout);
  }, [query]);

  const setQuantity = (productId, value) =>
    setLines((prev) => prev.map((l) => (l.product_id === productId ? { ...l, quantity: value } : l)));

  const remove = (productId) => setLines((prev) => prev.filter((l) => l.product_id !== productId));

  // Adding a product that's already on the quote adds one to its quantity.
  const add = (product) => {
    setLines((prev) =>
      prev.some((l) => l.product_id === product.id)
        ? prev.map((l) => (l.product_id === product.id ? { ...l, quantity: Number(l.quantity || 0) + 1 } : l))
        : [...prev, { product_id: product.id, name: product.name, sku: product.sku, quantity: 1, discount_percent: '' }]
    );
    setQuery('');
    setResults([]);
  };

  const badDiscount = (l) => l.discount_percent !== '' && !(Number(l.discount_percent) >= 0 && Number(l.discount_percent) < 100);
  const invalid =
    lines.length === 0 ||
    lines.some((l) => !Number.isInteger(Number(l.quantity)) || Number(l.quantity) < 1 || (staff && badDiscount(l)));
  const anyDiscount = staff && lines.some((l) => Number(l.discount_percent) > 0);

  const save = async () => {
    setError('');
    setSaving(true);
    try {
      await editQuoteItems(
        quote.id,
        lines.map((l) => ({
          product_id: l.product_id,
          quantity: Number(l.quantity),
          ...(staff && Number(l.discount_percent) > 0
            ? { discount_percent: Number(l.discount_percent), discount_reason: discountReason.trim() || 'Staff discount' }
            : {}),
        }))
      );
      await onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save the changes.');
      setSaving(false);
    }
  };

  return (
    <Card className="mt-6 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium text-ink">Edit quote #{quote.quote_number}</p>
          <p className="mt-0.5 text-sm text-slate-500">
            Change quantities, remove products or add new ones. When you save, the whole quote is priced at
            today&apos;s prices, including any current discounts.
          </p>
        </div>
      </div>

      <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-100">
        {lines.map((line) => (
          <li key={line.product_id} className="flex flex-wrap items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{line.name}</p>
              <p className="font-mono text-xs text-slate-400">{line.sku}</p>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-500">
              Qty
              <input
                type="number"
                min={1}
                step={1}
                value={line.quantity}
                onChange={(e) => setQuantity(line.product_id, e.target.value)}
                aria-label={`Quantity of ${line.name}`}
                className={`${INPUT} w-20 py-1`}
              />
            </label>
            {staff && (
              <label className="flex items-center gap-2 text-xs text-slate-500">
                Discount %
                <input
                  type="number"
                  min={0}
                  max={99.99}
                  step="0.01"
                  value={line.discount_percent}
                  onChange={(e) =>
                    setLines((prev) => prev.map((l) => (l.product_id === line.product_id ? { ...l, discount_percent: e.target.value } : l)))
                  }
                  placeholder="0"
                  aria-label={`Discount for ${line.name}`}
                  className={`${INPUT} w-20 py-1`}
                />
              </label>
            )}
            <button
              type="button"
              onClick={() => remove(line.product_id)}
              className="text-xs font-medium text-bad-500 hover:underline"
            >
              Remove
            </button>
          </li>
        ))}
        {lines.length === 0 && <li className="px-3 py-3 text-sm text-slate-500">Add at least one product.</li>}
      </ul>

      <div className="relative mt-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Add a product: search by name or SKU"
          className={`${INPUT} w-full`}
        />
        {results.length > 0 && (
          <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-card">
            {results.map((product) => (
              <li key={product.id}>
                <button
                  type="button"
                  onClick={() => add(product)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-ink">{product.name}</span>
                    <span className="font-mono text-xs text-slate-400">{product.sku}</span>
                  </span>
                  <span className="shrink-0 text-xs text-slate-500">
                    {formatCurrency(product.discount ? product.discount.price : product.unit_price)} excl. VAT
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {anyDiscount && (
        <div className="mt-3 max-w-md">
          <label htmlFor="edit-discount-reason" className="block text-xs font-medium text-slate-600">
            Discount reason (the customer sees this)
          </label>
          <input
            id="edit-discount-reason"
            value={discountReason}
            onChange={(e) => setDiscountReason(e.target.value)}
            maxLength={200}
            placeholder="Staff discount"
            className={`${INPUT} mt-1 w-full`}
          />
        </div>
      )}
      {staff && lines.some(badDiscount) && (
        <p className="mt-2 text-sm text-bad-500">A discount must be from 0% to less than 100%.</p>
      )}

      {error && <p className="mt-3 rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-500">{error}</p>}

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={save} loading={saving} disabled={invalid}>
          Save changes
        </Button>
      </div>
    </Card>
  );
}

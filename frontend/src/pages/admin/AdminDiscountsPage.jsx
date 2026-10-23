import { useEffect, useState } from 'react';
import { getDiscounts, createDiscount, endDiscount } from '../../api/discounts';
import { getProducts } from '../../api/products';
import useCategories from '../../hooks/useCategories';
import { formatCurrency, formatDate, formatDay } from '../../utils/formatters';
import { discountLabel } from '../../utils/discounts';
import Button from '../../components/ui/Button';
import Spinner from '../../components/ui/Spinner';
import Card from '../../components/ui/Card';
import Modal from '../../components/ui/Modal';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import EmptyState from '../../components/ui/EmptyState';

const INPUT_CLASS =
  'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-teal-500';
const PICKER_PAGE_SIZE = 100;

// Same rounding as the server (backend/src/utils/discounts.js), for previews.
const afterDiscount = (price, percent) => Math.round(Number(price) * (100 - Number(percent))) / 100;

// Picks the products a new discount applies to: search or filter by
// category, tick products, or tick every product shown. A product already on
// another active discount can't be picked (one discount per product).
function ProductPicker({ selected, onChange }) {
  const { categories } = useCategories();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [products, setProducts] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setLoading(true);
      getProducts({ search, category: category || undefined, page: 1, limit: PICKER_PAGE_SIZE })
        .then(({ data }) => {
          setProducts(data.data);
          setTotal(data.total);
        })
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(timeout);
  }, [search, category]);

  const pickable = products.filter((p) => !p.discount);
  const allShownPicked = pickable.length > 0 && pickable.every((p) => selected.has(p.id));

  const toggle = (product) => {
    const next = new Map(selected);
    if (next.has(product.id)) next.delete(product.id);
    else next.set(product.id, product);
    onChange(next);
  };

  const toggleAllShown = () => {
    const next = new Map(selected);
    for (const p of pickable) {
      if (allShownPicked) next.delete(p.id);
      else next.set(p.id, p);
    }
    onChange(next);
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={INPUT_CLASS}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or SKU"
          className={`${INPUT_CLASS} min-w-0 flex-1`}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={allShownPicked}
            onChange={toggleAllShown}
            disabled={pickable.length === 0}
            className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
          />
          Select all shown
        </label>
        <span>
          {total > products.length ? `Showing ${products.length} of ${total}; search to narrow it down. · ` : ''}
          {selected.size} selected
        </span>
      </div>

      <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-slate-100">
        {loading ? (
          <Spinner />
        ) : products.length === 0 ? (
          <p className="p-3 text-sm text-slate-500">No products match.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {products.map((product) => (
              <li key={product.id}>
                <label
                  className={`flex items-center gap-3 px-3 py-2 text-sm ${
                    product.discount ? 'opacity-60' : 'cursor-pointer hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(product.id)}
                    onChange={() => toggle(product)}
                    disabled={Boolean(product.discount)}
                    className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ink">{product.name}</span>
                    <span className="font-mono text-xs text-slate-400">{product.sku}</span>
                  </span>
                  <span className="text-right text-xs text-slate-500">
                    {formatCurrency(product.unit_price)}
                    {product.discount && (
                      <span className="block text-good-500">Already {discountLabel(product.discount.percent)}</span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function NewDiscountForm({ onCreated, onCancel }) {
  const [reason, setReason] = useState('');
  const [percent, setPercent] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [selected, setSelected] = useState(new Map());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const pct = Number(percent);
  const example = [...selected.values()][0];

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await createDiscount({ reason, percent: pct, ends_on: endsOn || null, product_ids: [...selected.keys()] });
      await onCreated();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create the discount.');
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label htmlFor="discount-reason" className="block text-sm font-medium text-ink">
          Reason
        </label>
        <input
          id="discount-reason"
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={200}
          placeholder="e.g. End-of-year clearance"
          className={`${INPUT_CLASS} mt-1 w-full`}
          required
        />
        <p className="mt-1 text-xs text-slate-400">Customers see this next to the price.</p>
      </div>

      <div className="flex flex-wrap gap-4">
        <div>
          <label htmlFor="discount-percent" className="block text-sm font-medium text-ink">
            Discount (%)
          </label>
          <input
            id="discount-percent"
            type="number"
            min={0.01}
            max={99.99}
            step={0.01}
            value={percent}
            onChange={(e) => setPercent(e.target.value)}
            className={`${INPUT_CLASS} mt-1 w-28`}
            required
          />
        </div>
        <div>
          <label htmlFor="discount-ends" className="block text-sm font-medium text-ink">
            Last day (optional)
          </label>
          <input
            id="discount-ends"
            type="date"
            value={endsOn}
            onChange={(e) => setEndsOn(e.target.value)}
            className={`${INPUT_CLASS} mt-1`}
          />
          <p className="mt-1 text-xs text-slate-400">Leave empty to run until you end it.</p>
        </div>
      </div>

      <div>
        <p className="text-sm font-medium text-ink">Products</p>
        <div className="mt-1">
          <ProductPicker selected={selected} onChange={setSelected} />
        </div>
      </div>

      {example && pct > 0 && pct < 100 && (
        <p className="text-sm text-slate-600">
          For example, {example.name}: {formatCurrency(example.unit_price)} becomes{' '}
          <span className="font-medium text-good-500">{formatCurrency(afterDiscount(example.unit_price, pct))}</span>{' '}
          excl. VAT.
        </p>
      )}

      {error && <p className="rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-500">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" loading={saving} disabled={selected.size === 0}>
          {selected.size === 0
            ? 'Pick products'
            : `Put ${selected.size} product${selected.size === 1 ? '' : 's'} on discount`}
        </Button>
      </div>
    </form>
  );
}

// Admin only. A discount changes what customers pay: a reason they see, a
// percentage off, an optional last day, and the products it covers. Saved
// quotes priced with a discount can't be ordered once it ends.
export default function AdminDiscountsPage() {
  const [discounts, setDiscounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [ending, setEnding] = useState(null);
  const [endingBusy, setEndingBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () =>
    getDiscounts()
      .then(({ data }) => setDiscounts(data))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const handleEnd = async () => {
    setError('');
    setEndingBusy(true);
    try {
      await endDiscount(ending.id);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not end this discount.');
    } finally {
      setEndingBusy(false);
      setEnding(null);
    }
  };

  const statusText = (discount) => {
    if (discount.active) {
      return discount.ends_on ? `Active until ${formatDay(discount.ends_on)}` : 'Active until ended';
    }
    return discount.ended_at ? `Ended ${formatDate(discount.ended_at)}` : `Ended after ${formatDay(discount.ends_on)}`;
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">Discounts</h1>
          <p className="mt-1 text-sm text-slate-500">
            Put products on discount. Customers see them in the deals banner and with Deals only on the Products
            page.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>New discount</Button>
      </div>

      {error && <p className="mt-4 rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-500">{error}</p>}

      {loading ? (
        <Spinner />
      ) : discounts.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="No discounts yet" description="Create one to put products on sale." />
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {discounts.map((discount) => (
            <Card key={discount.id} className={`p-4 ${discount.active ? '' : 'opacity-60'}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-ink">{discountLabel(discount.percent, discount.reason)}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {statusText(discount)} · created {formatDate(discount.created_at)}
                    {discount.created_by_user &&
                      ` by ${discount.created_by_user.full_name || discount.created_by_user.email}`}
                  </p>
                </div>
                {discount.active && (
                  <Button variant="danger" onClick={() => setEnding(discount)}>
                    End now
                  </Button>
                )}
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-teal-600">
                  {discount.products.length} product{discount.products.length === 1 ? '' : 's'}
                </summary>
                <ul className="mt-2 divide-y divide-slate-100 text-sm">
                  {discount.products.map((product) => (
                    <li key={product.id} className="flex justify-between gap-3 py-1.5">
                      <span className="min-w-0 truncate text-ink">
                        {product.name} <span className="font-mono text-xs text-slate-400">{product.sku}</span>
                      </span>
                      <span className="whitespace-nowrap text-slate-500">
                        {formatCurrency(product.unit_price)} → {formatCurrency(afterDiscount(product.unit_price, discount.percent))}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            </Card>
          ))}
        </div>
      )}

      {creating && (
        <Modal title="New discount" wide onClose={() => setCreating(false)}>
          <NewDiscountForm
            onCreated={async () => {
              setCreating(false);
              await load();
            }}
            onCancel={() => setCreating(false)}
          />
        </Modal>
      )}

      {ending && (
        <ConfirmDialog
          title="End this discount?"
          message={`${discountLabel(ending.percent, ending.reason)} ends now on ${ending.products.length} product(s). Saved quotes priced with it can no longer be ordered; customers will be offered an updated quote.`}
          confirmLabel="End discount"
          onConfirm={handleEnd}
          onCancel={() => setEnding(null)}
          loading={endingBusy}
        />
      )}
    </div>
  );
}

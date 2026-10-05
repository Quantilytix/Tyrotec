import { useState } from 'react';
import Button from '../ui/Button';
import { createStockAdjustment } from '../../api/stock';
import { formatCurrency } from '../../utils/formatters';

const FIELD_CLASS =
  'mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-teal-500';
const LABEL_CLASS = 'block text-xs font-medium text-slate-600';

const REASONS = [
  { value: 'damaged', label: 'Damaged' },
  { value: 'lost', label: 'Lost / stolen' },
  { value: 'count_correction', label: 'Stock count correction' },
  { value: 'returned_to_supplier', label: 'Returned to supplier' },
  { value: 'other', label: 'Other (explain in the note)' },
];

// Body of the "Adjust stock" modal (admins). For anything that isn't a
// purchase or a sale: the reason and the value at average cost are recorded,
// and the change is posted to the books in QX.
export default function StockAdjustmentForm({ product, onDone, onCancel }) {
  const [direction, setDirection] = useState('remove');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('damaged');
  const [note, setNote] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const qty = Number(quantity) || 0;
  const change = direction === 'remove' ? -qty : qty;
  const newStock = product.stock_quantity + change;
  const needsCost = product.supplier_cost == null;
  const cost = needsCost ? Number(unitCost) || 0 : Number(product.supplier_cost);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await createStockAdjustment({
        product_id: product.id,
        quantity_change: change,
        reason,
        note: note || null,
        unit_cost: needsCost ? Number(unitCost) : null,
      });
      onDone();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not adjust the stock.');
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-slate-500">
        {product.name} <span className="font-mono text-xs">({product.sku})</span> · {product.stock_quantity} in stock
        {!needsCost && ` · average cost ${formatCurrency(product.supplier_cost)}`}
      </p>
      <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
        Stock that arrived from a supplier is recorded under Purchases instead, so its cost is captured.
      </p>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={LABEL_CLASS}>Change</label>
          <select value={direction} onChange={(e) => setDirection(e.target.value)} className={FIELD_CLASS}>
            <option value="remove">Remove stock</option>
            <option value="add">Add stock</option>
          </select>
        </div>
        <div>
          <label className={LABEL_CLASS}>Quantity</label>
          <input required type="number" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={FIELD_CLASS} />
        </div>
      </div>

      <div>
        <label className={LABEL_CLASS}>Reason</label>
        <select value={reason} onChange={(e) => setReason(e.target.value)} className={FIELD_CLASS}>
          {REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      {needsCost && (
        <div>
          <label className={LABEL_CLASS}>Unit cost (excl. VAT)</label>
          <input required type="number" min="0" step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} className={FIELD_CLASS} />
          <p className="mt-1 text-xs text-slate-400">This product has no cost yet, so enter what one unit is worth.</p>
        </div>
      )}

      <div>
        <label className={LABEL_CLASS}>Note {reason === 'other' ? '' : '(optional)'}</label>
        <textarea required={reason === 'other'} value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={FIELD_CLASS} />
      </div>

      {qty > 0 && (
        <p className={`text-sm ${newStock < 0 ? 'text-bad-500' : 'text-slate-600'}`}>
          {newStock < 0
            ? `Only ${product.stock_quantity} in stock.`
            : `Stock ${product.stock_quantity} → ${newStock}, valued at ${formatCurrency(qty * cost)}.`}
        </p>
      )}

      {error && <p className="rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-500">{error}</p>}

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" loading={saving} disabled={qty <= 0 || newStock < 0}>
          Save adjustment
        </Button>
      </div>
    </form>
  );
}

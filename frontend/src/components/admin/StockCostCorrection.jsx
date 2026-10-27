import { useState } from 'react';
import { correctStockAndCost } from '../../api/stock';
import { formatCurrency } from '../../utils/formatters';
import Button from '../ui/Button';

const FIELD =
  'mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-teal-500';
const LABEL = 'block text-xs font-medium text-slate-600';

// A product's stock and average cost, on the product form. Admins can put
// either right when a mistake was made (a cost missing a 0, a miscount),
// with a note saying why. It saves on its own, as a recorded correction
// (backend 041_correct_stock_and_cost.sql), not with the product's details.
export default function StockCostCorrection({ product, canCorrect, onCorrected }) {
  const [current, setCurrent] = useState({ stock: product.stock_quantity, cost: product.supplier_cost });
  const [open, setOpen] = useState(false);
  const [stock, setStock] = useState(String(product.stock_quantity));
  const [cost, setCost] = useState(product.supplier_cost == null ? '' : String(product.supplier_cost));
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const stockChanged = stock !== '' && Number(stock) !== Number(current.stock);
  const costChanged = cost !== '' && Number(cost) !== Number(current.cost ?? NaN);

  const save = async () => {
    setError('');
    setDone('');
    setSaving(true);
    try {
      const { data } = await correctStockAndCost({
        product_id: product.id,
        stock_quantity: stockChanged ? stock : '',
        supplier_cost: costChanged ? cost : '',
        note,
      });
      setCurrent({ stock: data.stock_after, cost: data.cost_after });
      setStock(String(data.stock_after));
      setCost(data.cost_after == null ? '' : String(data.cost_after));
      setNote('');
      setOpen(false);
      setDone('Correction saved and recorded in the activity log.');
      onCorrected?.();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save the correction.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-1 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
      <p>
        <span className="font-medium text-ink">{current.stock}</span> in stock
      </p>
      <p className="mt-0.5">
        Average cost{' '}
        <span className="font-medium text-ink">{current.cost != null ? formatCurrency(current.cost) : 'not known yet'}</span>
      </p>
      {done && <p className="mt-1 text-xs text-good-500">{done}</p>}

      {canCorrect && !open && (
        <button type="button" onClick={() => setOpen(true)} className="mt-1 text-xs font-medium text-teal-600 hover:underline">
          Correct stock or cost
        </button>
      )}

      {canCorrect && open && (
        <div className="mt-2 space-y-2 border-t border-slate-200 pt-2">
          <p className="text-xs text-slate-500">
            For fixing mistakes. A stock change is recorded as a count correction; both are kept in the activity log.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="correct-stock" className={LABEL}>Stock</label>
              <input id="correct-stock" type="number" min={0} step={1} value={stock} onChange={(e) => setStock(e.target.value)} className={FIELD} />
            </div>
            <div>
              <label htmlFor="correct-cost" className={LABEL}>Average cost (excl. VAT)</label>
              <input id="correct-cost" type="number" min={0} step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} className={FIELD} />
            </div>
          </div>
          <div>
            <label htmlFor="correct-note" className={LABEL}>Why (required)</label>
            <input
              id="correct-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder="e.g. Cost typed without a 0"
              className={FIELD}
            />
          </div>
          {error && <p className="rounded-lg bg-bad-50 px-3 py-2 text-xs text-bad-500">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={save}
              loading={saving}
              disabled={(!stockChanged && !costChanged) || !note.trim()}
            >
              Save correction
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

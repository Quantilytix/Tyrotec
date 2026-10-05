import { useEffect, useMemo, useState } from 'react';
import { getOpeningStock, recordOpeningStock } from '../../api/stock';
import { formatCurrency, formatDate, formatDay } from '../../utils/formatters';
import Button from '../../components/ui/Button';
import Spinner from '../../components/ui/Spinner';
import Card from '../../components/ui/Card';
import ConfirmDialog from '../../components/ui/ConfirmDialog';

const CELL_INPUT =
  'w-32 rounded-md border border-slate-200 px-2 py-1 text-sm outline-none transition-colors duration-150 focus:border-teal-500';

const today = () => new Date().toISOString().slice(0, 10);

// Admin, once, at go-live: records the value of the stock already on the
// shelf (which has no purchase behind it), so the books start from the right
// stock value. Every later stock change comes from purchases, sales and
// adjustments.
export default function AdminOpeningStockPage() {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [asOfDate, setAsOfDate] = useState(today());
  const [costs, setCosts] = useState({});
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = () =>
    getOpeningStock()
      .then(({ data }) => setState(data))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const total = useMemo(() => {
    if (!state?.lines) return 0;
    return state.lines.reduce((sum, p) => {
      const cost = p.supplier_cost ?? (costs[p.id] === '' || costs[p.id] === undefined ? null : Number(costs[p.id]));
      return sum + (cost == null ? 0 : p.stock_quantity * cost);
    }, 0);
  }, [state, costs]);

  const stillMissing = (state?.missing_cost || []).filter((p) => costs[p.id] === undefined || costs[p.id] === '');

  const handleRecord = async () => {
    setError('');
    setSaving(true);
    try {
      const filled = Object.fromEntries(
        Object.entries(costs).filter(([, v]) => v !== '' && v !== undefined).map(([k, v]) => [k, Number(v)])
      );
      await recordOpeningStock({ asOfDate, costs: filled });
      setConfirming(false);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not record the opening stock.');
      setConfirming(false);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner />;

  if (state?.recorded) {
    const { recorded } = state;
    return (
      <div>
        <h1 className="font-display text-xl font-semibold text-ink">Opening stock</h1>
        <p className="mt-1 text-sm text-slate-500">
          Recorded on {formatDate(recorded.created_at)} as at {formatDay(recorded.as_of_date)}:{' '}
          {recorded.lines.length} product(s) worth {formatCurrency(recorded.total_value)}. This is done once.
        </p>
        <Card className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3 text-right">Qty</th>
                <th className="px-4 py-3 text-right">Unit cost</th>
                <th className="px-4 py-3 text-right">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recorded.lines.map((line) => (
                <tr key={line.product_id}>
                  <td className="px-4 py-3">
                    <p className="text-ink">{line.name}</p>
                    <p className="font-mono text-xs text-slate-400">{line.sku}</p>
                  </td>
                  <td className="px-4 py-3 text-right">{line.quantity}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatCurrency(line.unit_cost)}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatCurrency(line.quantity * line.unit_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-display text-xl font-semibold text-ink">Opening stock</h1>
      <p className="mt-1 max-w-2xl text-sm text-slate-500">
        Do this once, when you start recording purchases. It values the stock already on the shelf so the books
        start from the right figure. Check the quantities first: fix any wrong count with a stock adjustment on the
        Products page before recording.
      </p>

      <Card className="mt-6 flex flex-wrap items-end gap-4 p-5">
        <div>
          <label className="block text-xs font-medium text-slate-600">Stock count as at</label>
          <input
            type="date"
            max={today()}
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            className="mt-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500"
          />
        </div>
        <div className="text-sm">
          <p className="text-slate-500">Total value</p>
          <p className="font-mono text-lg font-semibold text-ink">{formatCurrency(total)}</p>
        </div>
        <div className="ml-auto">
          <Button onClick={() => setConfirming(true)} disabled={stillMissing.length > 0 || state.lines.length === 0}>
            Record opening stock
          </Button>
        </div>
      </Card>

      {stillMissing.length > 0 && (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
          {stillMissing.length} product(s) with stock have no cost yet. Enter a unit cost for each below.
        </p>
      )}
      {error && <p className="mt-4 rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-500">{error}</p>}

      <Card className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3 text-right">In stock</th>
              <th className="px-4 py-3 text-right">Unit cost (excl. VAT)</th>
              <th className="px-4 py-3 text-right">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {state.lines.map((p) => {
              const cost = p.supplier_cost ?? (costs[p.id] === '' || costs[p.id] === undefined ? null : Number(costs[p.id]));
              return (
                <tr key={p.id}>
                  <td className="px-4 py-3">
                    <p className="text-ink">{p.name}</p>
                    <p className="font-mono text-xs text-slate-400">{p.sku}</p>
                  </td>
                  <td className="px-4 py-3 text-right">{p.stock_quantity}</td>
                  <td className="px-4 py-3 text-right">
                    {p.supplier_cost != null ? (
                      <span className="font-mono">{formatCurrency(p.supplier_cost)}</span>
                    ) : (
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={costs[p.id] ?? ''}
                        onChange={(e) => setCosts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        className={CELL_INPUT}
                        placeholder="Cost"
                      />
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{cost == null ? '—' : formatCurrency(p.stock_quantity * cost)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {confirming && (
        <ConfirmDialog
          title="Record opening stock?"
          message={`This records ${state.lines.length} product(s) worth ${formatCurrency(total)} as at ${formatDay(asOfDate)}. It can only be done once.`}
          confirmLabel="Record opening stock"
          onConfirm={handleRecord}
          onCancel={() => setConfirming(false)}
          loading={saving}
        />
      )}
    </div>
  );
}

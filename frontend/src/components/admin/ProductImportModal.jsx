import { useState } from 'react';
import Button from '../ui/Button';
import CategorySelect from './CategorySelect';
import { extractProductImport, confirmProductImport } from '../../api/products';

const DEFAULT_AVAILABILITY = 'local';
const DEFAULT_LEAD_TIME_DAYS = 7;
const DEFAULT_MIN_ORDER_QTY = 1;

const CELL_INPUT = 'w-full rounded-md border border-slate-200 px-2 py-1 text-sm outline-none transition-colors duration-150 focus:border-teal-500';

function toReviewRow(row) {
  return {
    ...row,
    sku: row.sku || '',
    category: row.category || '',
    description: row.description || '',
    action: row.matchedProductId ? 'restock' : 'create',
    availability: DEFAULT_AVAILABILITY,
    lead_time_days: DEFAULT_LEAD_TIME_DAYS,
    min_order_qty: DEFAULT_MIN_ORDER_QTY,
  };
}

export default function ProductImportModal({ onDone, categories = [], onCreateCategory }) {
  const [step, setStep] = useState('upload'); // 'upload' | 'review'
  const [file, setFile] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);

  const handleExtract = async () => {
    if (!file) return;
    setError('');
    setExtracting(true);
    try {
      const { data } = await extractProductImport(file);
      setRows(data.rows.map(toReviewRow));
      setStep('review');
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't read that file. Try again.");
    } finally {
      setExtracting(false);
    }
  };

  const updateRow = (index, field, value) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  };

  const handleConfirm = async () => {
    setError('');
    setConfirming(true);
    try {
      const payload = rows
        .filter((r) => r.action !== 'skip')
        .map((r) => ({
          action: r.action,
          productId: r.matchedProductId,
          name: r.name,
          sku: r.sku,
          category: r.category,
          description: r.description,
          unit_price: Number(r.unit_price),
          quantity: Number(r.quantity),
          availability: r.availability,
          lead_time_days: Number(r.lead_time_days),
          min_order_qty: Number(r.min_order_qty),
        }));

      const { data } = await confirmProductImport(payload);
      setSummary(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not import these products.');
    } finally {
      setConfirming(false);
    }
  };

  if (summary) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-ink">
          {summary.restocked.length} product{summary.restocked.length === 1 ? '' : 's'} restocked,{' '}
          {summary.created.length} new product{summary.created.length === 1 ? '' : 's'} created.
        </p>
        {summary.errors.length > 0 && (
          <div className="rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-500">
            <p className="font-medium">{summary.errors.length} row(s) couldn't be imported:</p>
            <ul className="mt-1 list-disc pl-5">
              {summary.errors.map((e, i) => (
                <li key={i}>
                  {e.row.name}: {e.error}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex justify-end">
          <Button onClick={onDone}>Done</Button>
        </div>
      </div>
    );
  }

  if (step === 'upload') {
    return (
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          Upload a supplier receipt (photo, scan, or PDF) or a spreadsheet (.xlsx, .csv) of products you've
          bought.
        </p>
        <input
          type="file"
          accept="image/*,.pdf,.xlsx,.csv"
          onChange={(e) => setFile(e.target.files[0] || null)}
          className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-teal-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-teal-700 hover:file:bg-teal-100"
        />
        {error && <p className="rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-500">{error}</p>}
        <div className="flex justify-end">
          <Button onClick={handleExtract} loading={extracting} disabled={!file}>
            Extract products
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Review what Gemini found, adjust anything that looks wrong, then confirm to save. Every new product
        needs a SKU and a category.
      </p>

      <div className="max-h-[50vh] overflow-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="sticky top-0 border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Unit price</th>
              <th className="px-3 py-2">Qty</th>
              <th className="px-3 py-2">Availability</th>
              <th className="px-3 py-2">Lead (days)</th>
              <th className="px-3 py-2">Min order</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, i) => (
              <tr key={i} className={row.action === 'skip' ? 'opacity-50' : ''}>
                <td className="px-3 py-2">
                  <select
                    value={row.action}
                    onChange={(e) => updateRow(i, 'action', e.target.value)}
                    className={CELL_INPUT}
                  >
                    {row.matchedProductId && (
                      <option value="restock">Add stock to {row.matchedProductName}</option>
                    )}
                    <option value="create">Create new product</option>
                    <option value="skip">Skip</option>
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input value={row.name} onChange={(e) => updateRow(i, 'name', e.target.value)} className={CELL_INPUT} />
                </td>
                <td className="px-3 py-2">
                  <input
                    value={row.sku}
                    onChange={(e) => updateRow(i, 'sku', e.target.value)}
                    className={CELL_INPUT}
                    placeholder={row.action === 'create' ? 'required' : ''}
                  />
                </td>
                <td className="px-3 py-2">
                  {/* Only a new product needs a category; a restock keeps the
                      one already on the matched product. */}
                  {row.action === 'create' ? (
                    <CategorySelect
                      value={row.category}
                      onChange={(category) => updateRow(i, 'category', category)}
                      categories={categories}
                      onCreateCategory={onCreateCategory}
                      selectClassName={`${CELL_INPUT} min-w-[11rem]`}
                      placeholder="Pick a category"
                    />
                  ) : (
                    <span className="text-slate-300">--</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={row.unit_price}
                    onChange={(e) => updateRow(i, 'unit_price', e.target.value)}
                    className={CELL_INPUT}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min="0"
                    value={row.quantity}
                    onChange={(e) => updateRow(i, 'quantity', e.target.value)}
                    className={CELL_INPUT}
                  />
                </td>
                <td className="px-3 py-2">
                  {row.action === 'create' ? (
                    <select
                      value={row.availability}
                      onChange={(e) => updateRow(i, 'availability', e.target.value)}
                      className={CELL_INPUT}
                    >
                      <option value="local">Local</option>
                      <option value="national">National</option>
                      <option value="global">Global</option>
                    </select>
                  ) : (
                    <span className="text-slate-300">--</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {row.action === 'create' ? (
                    <input
                      type="number"
                      min="0"
                      value={row.lead_time_days}
                      onChange={(e) => updateRow(i, 'lead_time_days', e.target.value)}
                      className={CELL_INPUT}
                    />
                  ) : (
                    <span className="text-slate-300">--</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {row.action === 'create' ? (
                    <input
                      type="number"
                      min="1"
                      value={row.min_order_qty}
                      onChange={(e) => updateRow(i, 'min_order_qty', e.target.value)}
                      className={CELL_INPUT}
                    />
                  ) : (
                    <span className="text-slate-300">--</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && <p className="rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-500">{error}</p>}

      <div className="flex items-center justify-between">
        <Button variant="secondary" onClick={() => setStep('upload')} disabled={confirming}>
          Back
        </Button>
        <Button
          onClick={handleConfirm}
          loading={confirming}
          disabled={
            rows.every((r) => r.action === 'skip') ||
            rows.some((r) => r.action === 'create' && (!r.sku || !r.category))
          }
        >
          Confirm import
        </Button>
      </div>
    </div>
  );
}

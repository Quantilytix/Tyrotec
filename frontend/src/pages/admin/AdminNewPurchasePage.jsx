import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getProducts, extractProductImport } from '../../api/products';
import { getSuppliers } from '../../api/suppliers';
import { createPurchase } from '../../api/purchases';
import { formatCurrency } from '../../utils/formatters';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';

const FIELD_CLASS =
  'mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-teal-500';
const CELL_INPUT =
  'w-full rounded-md border border-slate-200 px-2 py-1 text-sm outline-none transition-colors duration-150 focus:border-teal-500';
const LABEL_CLASS = 'block text-xs font-medium text-slate-600';

const today = () => new Date().toISOString().slice(0, 10);
const cents = (n) => Math.round(Number(n || 0) * 100);

let nextKey = 1;
const newLine = (product = null, extra = {}) => ({
  key: nextKey++,
  product,
  quantity: 1,
  unit_cost: product?.supplier_cost ?? '',
  vat_rate: product ? (product.vat_applicable === false ? 0 : 15) : 15,
  ...extra,
});

// Searches the catalogue for one purchase line.
function ProductPicker({ onPick, hint }) {
  const [query, setQuery] = useState(hint || '');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return undefined;
    }
    const timeout = setTimeout(() => {
      getProducts({ search: query, limit: 8 }).then(({ data }) => setResults(data.data));
    }, 250);
    return () => clearTimeout(timeout);
  }, [query]);

  return (
    <div className="relative">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search product by name or SKU"
        className={CELL_INPUT}
      />
      {open && results.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-card">
          {results.map((product) => {
            return (
              <li key={product.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(product);
                    setOpen(false);
                  }}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span>
                    <span className="text-ink">{product.name}</span>
                    <span className="ml-2 font-mono text-xs text-slate-400">{product.sku}</span>
                  </span>
                  <span className="text-xs text-slate-400">{product.stock_quantity} in stock</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function AdminNewPurchasePage() {
  const navigate = useNavigate();
  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(today());
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([newLine()]);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getSuppliers().then(({ data }) => setSuppliers(data.data));
  }, []);

  const updateLine = (key, changes) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...changes } : l)));
  const removeLine = (key) => setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : [newLine()]));

  const totals = useMemo(() => {
    let net = 0;
    let vat = 0;
    for (const l of lines) {
      const lineNet = Math.round(Number(l.quantity || 0) * cents(l.unit_cost));
      net += lineNet;
      vat += Math.round((lineNet * Number(l.vat_rate)) / 100);
    }
    return { net: net / 100, vat: vat / 100, total: (net + vat) / 100 };
  }, [lines]);

  // Reads a supplier invoice (photo, PDF or spreadsheet) with the same extractor
  // the product import uses, and turns each line into a purchase line: the
  // price on a supplier's invoice is what we paid, i.e. the unit cost.
  const handleScan = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    setScanNote('');
    setScanning(true);
    try {
      const { data } = await extractProductImport(file);
      const scanned = data.rows.map((row) =>
        newLine(null, {
          quantity: row.quantity || 1,
          unit_cost: row.unit_price ?? '',
          hint: row.matchedProductName || row.sku || row.name,
          scannedName: row.name,
          matchedProductId: row.matchedProductId,
        })
      );
      // Resolve the extractor's matches to full products so they're pre-selected.
      const matched = await Promise.all(
        scanned.map(async (line) => {
          if (!line.matchedProductId) return line;
          const { data: found } = await getProducts({ search: line.hint, limit: 8 });
          const product = found.data.find((p) => p.id === line.matchedProductId);
          return product
            ? { ...line, product, vat_rate: product.vat_applicable === false ? 0 : 15 }
            : line;
        })
      );
      const unmatched = matched.filter((l) => !l.product).length;
      setLines(matched.length ? matched : [newLine()]);
      setScanNote(
        `Read ${matched.length} line(s).` +
          (unmatched ? ` ${unmatched} need a product chosen — add new products on the Products page first.` : '') +
          ' Check every quantity and cost against the invoice before saving.'
      );
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't read that file.");
    } finally {
      setScanning(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const missing = lines.findIndex((l) => !l.product);
    if (missing >= 0) {
      setError(`Line ${missing + 1}: choose a product.`);
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await createPurchase({
        supplier_id: supplierId,
        supplier_invoice_number: invoiceNumber,
        purchase_date: purchaseDate,
        due_date: dueDate || null,
        notes: notes || null,
        lines: lines.map((l) => ({
          product_id: l.product.id,
          quantity: Number(l.quantity),
          unit_cost: Number(l.unit_cost),
          vat_rate: Number(l.vat_rate),
        })),
      });
      navigate(`/admin/purchases/${data.id}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not record this purchase.');
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/admin/purchases" className="text-xs font-medium text-teal-600 hover:underline">
            ← Purchases
          </Link>
          <h1 className="mt-1 font-display text-xl font-semibold text-ink">Record a purchase</h1>
          <p className="mt-1 text-sm text-slate-500">
            Goods received from a supplier. Saving adds the stock and updates each product&apos;s average cost.
          </p>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors duration-150 hover:bg-slate-50">
          {scanning ? 'Reading invoice...' : 'Scan supplier invoice'}
          <input
            type="file"
            accept="image/*,application/pdf,.xlsx,.csv"
            onChange={handleScan}
            disabled={scanning}
            className="hidden"
          />
        </label>
      </div>

      <Card className="mt-6 p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className={LABEL_CLASS}>Supplier</label>
            <select required value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={FIELD_CLASS}>
              <option value="">Choose a supplier</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <Link to="/admin/suppliers" className="mt-1 inline-block text-xs text-teal-600 hover:underline">
              Manage suppliers
            </Link>
          </div>
          <div>
            <label className={LABEL_CLASS}>Supplier invoice / delivery note no.</label>
            <input required value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} className={FIELD_CLASS} />
          </div>
          <div>
            <label className={LABEL_CLASS}>Date received</label>
            <input required type="date" max={today()} value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} className={FIELD_CLASS} />
          </div>
          <div>
            <label className={LABEL_CLASS}>Due date (optional)</label>
            <input type="date" min={purchaseDate} value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={FIELD_CLASS} />
            <p className="mt-1 text-xs text-slate-400">Blank: the supplier&apos;s payment terms.</p>
          </div>
        </div>
      </Card>

      {scanNote && <p className="mt-4 rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-700">{scanNote}</p>}

      <Card className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Product</th>
              <th className="w-24 px-4 py-3">Qty</th>
              <th className="w-36 px-4 py-3">Unit cost (excl. VAT)</th>
              <th className="w-24 px-4 py-3">VAT</th>
              <th className="w-32 px-4 py-3 text-right">Line total</th>
              <th className="w-10 px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((line) => (
              <tr key={line.key} className="align-top">
                <td className="px-4 py-3">
                  {line.product ? (
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-ink">{line.product.name}</p>
                        <p className="font-mono text-xs text-slate-400">
                          {line.product.sku} · {line.product.stock_quantity} in stock
                          {line.product.supplier_cost != null && ` · avg cost ${formatCurrency(line.product.supplier_cost)}`}
                        </p>
                      </div>
                      <button type="button" onClick={() => updateLine(line.key, { product: null })} className="text-xs text-teal-600 hover:underline">
                        Change
                      </button>
                    </div>
                  ) : (
                    <>
                      <ProductPicker
                        hint={line.hint}
                        onPick={(product) =>
                          updateLine(line.key, {
                            product,
                            vat_rate: product.vat_applicable === false ? 0 : 15,
                            unit_cost: line.unit_cost === '' ? product.supplier_cost ?? '' : line.unit_cost,
                          })
                        }
                      />
                      {line.scannedName && <p className="mt-1 text-xs text-slate-400">On invoice: {line.scannedName}</p>}
                    </>
                  )}
                </td>
                <td className="px-4 py-3">
                  <input required type="number" min="1" step="1" value={line.quantity} onChange={(e) => updateLine(line.key, { quantity: e.target.value })} className={CELL_INPUT} />
                </td>
                <td className="px-4 py-3">
                  <input required type="number" min="0" step="0.01" value={line.unit_cost} onChange={(e) => updateLine(line.key, { unit_cost: e.target.value })} className={CELL_INPUT} />
                </td>
                <td className="px-4 py-3">
                  <select value={line.vat_rate} onChange={(e) => updateLine(line.key, { vat_rate: Number(e.target.value) })} className={CELL_INPUT}>
                    <option value={15}>15%</option>
                    <option value={0}>0%</option>
                  </select>
                </td>
                <td className="px-4 py-3 text-right font-mono text-ink">
                  {formatCurrency((Math.round(Number(line.quantity || 0) * cents(line.unit_cost)) / 100) * (1 + Number(line.vat_rate) / 100))}
                </td>
                <td className="px-4 py-3 text-right">
                  <button type="button" onClick={() => removeLine(line.key)} className="text-xs text-bad-500 hover:underline" aria-label="Remove line">
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex flex-wrap items-start justify-between gap-4 border-t border-slate-100 px-4 py-4">
          <Button type="button" variant="secondary" onClick={() => setLines((prev) => [...prev, newLine()])}>
            Add line
          </Button>
          <dl className="min-w-[220px] space-y-1 text-sm">
            <div className="flex justify-between gap-6"><dt className="text-slate-500">Subtotal</dt><dd className="font-mono">{formatCurrency(totals.net)}</dd></div>
            <div className="flex justify-between gap-6"><dt className="text-slate-500">VAT</dt><dd className="font-mono">{formatCurrency(totals.vat)}</dd></div>
            <div className="flex justify-between gap-6 font-medium text-ink"><dt>Total</dt><dd className="font-mono">{formatCurrency(totals.total)}</dd></div>
          </dl>
        </div>
      </Card>

      <Card className="mt-4 p-5">
        <label className={LABEL_CLASS}>Notes (optional)</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={FIELD_CLASS} />
      </Card>

      {error && <p className="mt-4 rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-500">{error}</p>}

      <div className="mt-6 flex items-center justify-end gap-3">
        <p className="text-xs text-slate-400">Purchases can&apos;t be edited after saving. Fix mistakes with a stock adjustment.</p>
        <Button type="button" variant="secondary" onClick={() => navigate('/admin/purchases')} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" loading={submitting}>
          Receive stock
        </Button>
      </div>
    </form>
  );
}

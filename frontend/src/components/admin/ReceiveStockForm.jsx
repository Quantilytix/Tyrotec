import { useEffect, useState } from 'react';
import Button from '../ui/Button';
import Spinner from '../ui/Spinner';
import { getSuppliers } from '../../api/suppliers';
import { getProductById } from '../../api/products';
import { receiveStockForOrder } from '../../api/orders';

const FIELD_CLASS =
  'mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-teal-500';
const LABEL_CLASS = 'block text-xs font-medium text-slate-600';

// "Stock received" for an order or invoice waiting for stock: staff record the
// supplier's delivery of what it's short of. It's saved as a purchase, like
// one captured on the Purchases page (so stock, costs and the books follow),
// and the order takes that stock straight away (045).
//
// shortLines: the order's items it can't supply yet, with products.stock_quantity.
export default function ReceiveStockForm({ order, shortLines, saleName, paid, onDone, onCancel }) {
  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [lines, setLines] = useState(() =>
    shortLines.map((item) => {
      const short = item.quantity - Math.max(item.products.stock_quantity, 0);
      return { product_id: item.product_id, name: item.products.name, short, quantity: String(short), unit_cost: '' };
    })
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // The suppliers to choose from, and each product's usual supplier and
  // current cost to start from (staff-only product details).
  useEffect(() => {
    Promise.all([getSuppliers(), ...shortLines.map((item) => getProductById(item.product_id))])
      .then(([{ data: supplierList }, ...productResponses]) => {
        setSuppliers(supplierList.data || []);
        const products = productResponses.map((r) => r.data);
        setSupplierId((current) => current || products.find((p) => p.supplier_id)?.supplier_id || '');
        setLines((prev) =>
          prev.map((line) => {
            const cost = products.find((p) => p.id === line.product_id)?.supplier_cost;
            return cost === null || cost === undefined || line.unit_cost !== '' ? line : { ...line, unit_cost: String(cost) };
          })
        );
      })
      .catch(() => setError('Could not load the suppliers. Close this and try again.'))
      .finally(() => setLoading(false));
    // Loaded once, for the lines short when the form opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLine = (productId, field, value) =>
    setLines((prev) => prev.map((l) => (l.product_id === productId ? { ...l, [field]: value } : l)));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await receiveStockForOrder(order.id, {
        supplier_id: supplierId,
        supplier_invoice_number: invoiceNumber,
        lines: lines.map((l) => ({ product_id: l.product_id, quantity: Number(l.quantity), unit_cost: Number(l.unit_cost) })),
      });
      await onDone();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not record the stock.');
      setSaving(false);
    }
  };

  if (loading) return <Spinner />;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
        Record the supplier&apos;s delivery of what {saleName} is waiting for. It&apos;s saved as a purchase, and{' '}
        {saleName} takes the stock straight away:{' '}
        {paid ? 'it is already paid, so it becomes Paid.' : 'the customer then has 3 days to pay.'}
      </p>

      <div>
        <label className={LABEL_CLASS}>Supplier</label>
        <select required value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={FIELD_CLASS}>
          <option value="">Choose the supplier</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={LABEL_CLASS}>Supplier invoice or delivery note number</label>
        <input required value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} className={FIELD_CLASS} />
      </div>

      <div className="space-y-3">
        {lines.map((line) => (
          <div key={line.product_id} className="rounded-lg border border-slate-200 p-3">
            <p className="text-sm font-medium text-ink">{line.name}</p>
            <p className="text-xs text-slate-500">Short by {line.short}</p>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL_CLASS}>Quantity received</label>
                <input
                  required
                  type="number"
                  min={line.short}
                  step={1}
                  value={line.quantity}
                  onChange={(e) => setLine(line.product_id, 'quantity', e.target.value)}
                  className={FIELD_CLASS}
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>Unit cost (excl. VAT)</label>
                <input
                  required
                  type="number"
                  min={0}
                  step="0.01"
                  value={line.unit_cost}
                  onChange={(e) => setLine(line.product_id, 'unit_cost', e.target.value)}
                  className={FIELD_CLASS}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {error && <p className="rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-500">{error}</p>}

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          Record stock received
        </Button>
      </div>
    </form>
  );
}

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getPurchase } from '../../api/purchases';
import { formatCurrency, formatDate, formatDay } from '../../utils/formatters';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import Card from '../../components/ui/Card';

export default function AdminPurchaseDetailPage() {
  const { id } = useParams();
  const [purchase, setPurchase] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPurchase(id)
      .then(({ data }) => setPurchase(data))
      .catch(() => setPurchase(null))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Spinner />;
  if (!purchase) return <EmptyState title="Purchase not found" description="Check the link and try again." />;

  const capturedBy = purchase.received_by_user?.full_name || purchase.received_by_user?.email;

  return (
    <div>
      <Link to="/admin/purchases" className="text-xs font-medium text-teal-600 hover:underline">
        ← Purchases
      </Link>
      <h1 className="mt-1 font-display text-xl font-semibold text-ink">Purchase #{purchase.purchase_number}</h1>
      <p className="mt-1 text-sm text-slate-500">
        Received {formatDay(purchase.purchase_date)} from {purchase.supplier?.name}
        {capturedBy ? ` · captured by ${capturedBy}` : ''} on {formatDate(purchase.created_at)}
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Supplier invoice</p>
          <p className="mt-1 font-mono text-ink">{purchase.supplier_invoice_number}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Due</p>
          <p className="mt-1 text-ink">
            {purchase.due_date
              ? formatDay(purchase.due_date)
              : `${purchase.supplier?.credit_terms_days ?? 30} days after receipt`}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Total (incl. VAT)</p>
          <p className="mt-1 font-mono text-lg font-semibold text-ink">{formatCurrency(purchase.total_amount)}</p>
        </Card>
      </div>

      <Card className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3 text-right">Qty</th>
              <th className="px-4 py-3 text-right">Unit cost</th>
              <th className="px-4 py-3 text-right">VAT</th>
              <th className="px-4 py-3 text-right">Line total (excl. VAT)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {purchase.purchase_items.map((item) => (
              <tr key={item.id}>
                <td className="px-4 py-3">
                  <p className="text-ink">{item.product?.name}</p>
                  <p className="font-mono text-xs text-slate-400">{item.product?.sku}</p>
                </td>
                <td className="px-4 py-3 text-right">{item.quantity}</td>
                <td className="px-4 py-3 text-right font-mono">{formatCurrency(item.unit_cost)}</td>
                <td className="px-4 py-3 text-right">{Number(item.vat_rate)}%</td>
                <td className="px-4 py-3 text-right font-mono">{formatCurrency(item.quantity * item.unit_cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="ml-auto max-w-xs space-y-1 border-t border-slate-100 px-4 py-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-500">Subtotal</dt>
            <dd className="font-mono">{formatCurrency(purchase.subtotal_amount)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">VAT</dt>
            <dd className="font-mono">{formatCurrency(purchase.vat_amount)}</dd>
          </div>
          <div className="flex justify-between font-medium text-ink">
            <dt>Total</dt>
            <dd className="font-mono">{formatCurrency(purchase.total_amount)}</dd>
          </div>
        </dl>
      </Card>

      {purchase.notes && (
        <Card className="mt-4 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Notes</p>
          <p className="mt-1 whitespace-pre-line text-sm text-ink">{purchase.notes}</p>
        </Card>
      )}
    </div>
  );
}

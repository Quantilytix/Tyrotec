import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getPurchases } from '../../api/purchases';
import { formatCurrency, formatDay } from '../../utils/formatters';
import Button from '../../components/ui/Button';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import Card from '../../components/ui/Card';

export default function AdminPurchasesPage() {
  const [purchases, setPurchases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  useEffect(() => {
    const timeout = setTimeout(() => {
      setLoading(true);
      getPurchases({ search: search || undefined, page, limit })
        .then(({ data }) => {
          setPurchases(data.data);
          setTotal(data.total);
        })
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(timeout);
  }, [search, page]);

  const totalPages = Math.max(Math.ceil(total / limit), 1);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">Purchases</h1>
          <p className="mt-1 text-sm text-slate-500">
            Stock received from suppliers. Each one added stock and updated average costs.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
            placeholder="Search supplier invoice no."
            className="w-64 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-teal-500"
          />
          <Link to="/admin/purchases/new">
            <Button>Record a purchase</Button>
          </Link>
        </div>
      </div>

      {loading ? (
        <Spinner />
      ) : purchases.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No purchases yet"
            description={search ? `Nothing matches "${search}".` : 'Record stock as it arrives from your suppliers.'}
          />
        </div>
      ) : (
        <>
          <Card className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Purchase</th>
                  <th className="px-4 py-3">Supplier</th>
                  <th className="px-4 py-3">Supplier invoice</th>
                  <th className="px-4 py-3">Received</th>
                  <th className="px-4 py-3 text-right">Total (incl. VAT)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {purchases.map((purchase) => (
                  <tr key={purchase.id}>
                    <td className="px-4 py-3 font-mono text-xs">
                      <Link to={`/admin/purchases/${purchase.id}`} className="text-teal-600 hover:underline">
                        #{purchase.purchase_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-ink">{purchase.supplier?.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{purchase.supplier_invoice_number}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDay(purchase.purchase_date)}</td>
                    <td className="px-4 py-3 text-right font-mono font-medium text-ink">
                      {formatCurrency(purchase.total_amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-3">
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <span className="text-sm text-slate-500">
                Page {page} of {totalPages}
              </span>
              <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

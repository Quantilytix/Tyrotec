import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAllCustomersAdmin } from '../../api/customers';
import { formatCurrency, formatDate } from '../../utils/formatters';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';

export default function AdminCustomersPage() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;
  const navigate = useNavigate();

  useEffect(() => {
    const timeout = setTimeout(() => {
      setLoading(true);
      getAllCustomersAdmin({ search, page, limit })
        .then(({ data }) => {
          setCustomers(data.data);
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
          <h1 className="font-display text-xl font-semibold text-ink">Customers</h1>
          <p className="mt-1 text-sm text-slate-500">Every customer account, their orders, and lifetime spend.</p>
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
          placeholder="Search by email or company"
          className="w-64 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-teal-500"
        />
      </div>

      {loading ? (
        <Spinner />
      ) : customers.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No customers found"
            description={search ? `Nothing matches "${search}".` : 'Customer signups will show up here.'}
          />
        </div>
      ) : (
        <>
          <Card className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Quotes</th>
                  <th className="px-4 py-3">Orders</th>
                  <th className="px-4 py-3">Total spent</th>
                  <th className="px-4 py-3">Last order</th>
                  <th className="px-4 py-3">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {customers.map((customer) => (
                  <tr
                    key={customer.id}
                    className="cursor-pointer transition-colors duration-150 hover:bg-slate-50"
                    onClick={() => navigate(`/admin/customers/${customer.id}`)}
                  >
                    <td className="px-4 py-3">
                      <p className="text-ink">{customer.company_name || customer.email}</p>
                      {customer.company_name && <p className="text-xs text-slate-400">{customer.email}</p>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{customer.quote_count}</td>
                    <td className="px-4 py-3 text-slate-600">{customer.order_count}</td>
                    <td className="px-4 py-3 font-mono font-medium text-ink">
                      {formatCurrency(customer.total_spent)}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {customer.last_order_at ? formatDate(customer.last_order_at) : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(customer.created_at)}</td>
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

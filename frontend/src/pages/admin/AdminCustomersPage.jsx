import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAllCustomersAdmin, setCustomerAccountTerms } from '../../api/customers';
import { formatCurrency, formatDate } from '../../utils/formatters';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import Pagination from '../../components/ui/Pagination';
import Modal from '../../components/ui/Modal';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import ActionMenu from '../../components/ui/ActionMenu';
import NewCustomerForm from '../../components/admin/NewCustomerForm';

export default function AdminCustomersPage() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [showNew, setShowNew] = useState(false);
  const [notice, setNotice] = useState(null); // { ok, text } | null
  const [changingTerms, setChangingTerms] = useState(null); // customer | null
  const [savingTerms, setSavingTerms] = useState(false);
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
  const nameOf = (customer) => customer.company_name || customer.email;

  // Ordering on account is a credit decision, so it's confirmed first (and
  // logged by the API), as on the customer's own page.
  const applyAccountTerms = async () => {
    const customer = changingTerms;
    const next = !customer.can_order_on_account;
    setSavingTerms(true);
    try {
      await setCustomerAccountTerms(customer.id, next);
      setCustomers((prev) => prev.map((c) => (c.id === customer.id ? { ...c, can_order_on_account: next } : c)));
      setNotice({ ok: true, text: `${nameOf(customer)} ${next ? 'can now order on account' : 'now has to pay before ordering'}.` });
    } catch (err) {
      setNotice({ ok: false, text: err.response?.data?.error || 'Could not change their account terms.' });
    } finally {
      setSavingTerms(false);
      setChangingTerms(null);
    }
  };

  // The everyday actions on a row; editing and history are on their page.
  const rowActions = (customer) => [
    { label: 'Open', onClick: () => navigate(`/admin/customers/${customer.id}`) },
    { label: 'New quote', onClick: () => navigate(`/admin/quotes/new?customer=${customer.id}`) },
    { label: 'New invoice', onClick: () => navigate(`/admin/invoices/new?customer=${customer.id}`) },
    { label: 'Send an email', onClick: () => (window.location.href = `mailto:${customer.email}`) },
    { divider: true },
    {
      label: customer.can_order_on_account ? 'Stop ordering on account' : 'Allow ordering on account',
      danger: customer.can_order_on_account,
      onClick: () => setChangingTerms(customer),
    },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">Customers</h1>
          <p className="mt-1 text-sm text-slate-500">Every customer account, their orders, and lifetime spend.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
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
          <Button onClick={() => setShowNew(true)}>New customer</Button>
        </div>
      </div>

      {notice && (
        <p className={`mt-4 rounded-lg px-3 py-2 text-sm ${notice.ok ? 'bg-good-50 text-good-500' : 'bg-bad-50 text-bad-500'}`}>
          {notice.text}
        </p>
      )}

      {showNew && (
        <Modal title="New customer" onClose={() => setShowNew(false)}>
          <NewCustomerForm
            onCreated={(customer) => navigate(`/admin/customers/${customer.id}`)}
            onCancel={() => setShowNew(false)}
          />
        </Modal>
      )}

      {changingTerms && (
        <ConfirmDialog
          title={changingTerms.can_order_on_account ? 'Stop account ordering?' : 'Allow ordering on account?'}
          message={
            changingTerms.can_order_on_account
              ? `${nameOf(changingTerms)} will have to pay through PayFast again. Orders already placed on account are unaffected.`
              : `${nameOf(changingTerms)} will be able to place orders without paying first. Stock is committed immediately and you collect payment on invoice.`
          }
          confirmLabel={changingTerms.can_order_on_account ? 'Disable' : 'Enable'}
          onConfirm={applyAccountTerms}
          onCancel={() => setChangingTerms(null)}
          loading={savingTerms}
        />
      )}

      {loading ? (
        <Spinner />
      ) : customers.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No customers found"
            description={search ? `Nothing matches "${search}".` : 'Customer signups, and customers you add, will show up here.'}
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
                  <th className="px-4 py-3 text-right">Actions</th>
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
                    <td className="px-4 py-3 text-right">
                      <ActionMenu items={rowActions(customer)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </>
      )}
    </div>
  );
}

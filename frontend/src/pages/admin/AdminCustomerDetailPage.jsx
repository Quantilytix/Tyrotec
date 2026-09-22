import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getCustomerDetailAdmin, setCustomerAccountTerms } from '../../api/customers';
import { formatCurrency, formatDate } from '../../utils/formatters';
import StatusBadge from '../../components/ui/StatusBadge';
import SourceBadge from '../../components/ui/SourceBadge';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';

export default function AdminCustomerDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [confirmingTerms, setConfirmingTerms] = useState(false);
  const [savingTerms, setSavingTerms] = useState(false);
  const [termsError, setTermsError] = useState('');

  useEffect(() => {
    getCustomerDetailAdmin(id)
      .then(({ data }) => setCustomer(data))
      .finally(() => setLoading(false));
  }, [id]);

  // Turning this on lets the customer take goods before paying, so it's
  // confirmed rather than a one-click toggle, and the API records it in the
  // audit log either way.
  const applyAccountTerms = async () => {
    setTermsError('');
    setSavingTerms(true);
    try {
      const next = !customer.can_order_on_account;
      await setCustomerAccountTerms(id, next);
      setCustomer((c) => ({ ...c, can_order_on_account: next }));
      setConfirmingTerms(false);
    } catch (err) {
      setTermsError(err.response?.data?.error || 'Could not update this setting.');
    } finally {
      setSavingTerms(false);
    }
  };

  if (loading) return <Spinner />;
  if (!customer) return <p className="text-sm text-slate-500">Customer not found.</p>;

  return (
    <div>
      <Link to="/admin/customers" className="text-sm text-teal-600 hover:underline">
        ← Back to customers
      </Link>

      <div className="mt-3">
        <h1 className="font-display text-xl font-semibold text-ink">
          {customer.company_name || customer.email}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {customer.email} · Joined {formatDate(customer.created_at)}
        </p>
        <p className="mt-1 text-sm text-slate-500">
          WhatsApp:{' '}
          {customer.phone ? (
            <span className="font-medium text-ink">{customer.phone}</span>
          ) : (
            <span className="text-slate-400">Not linked</span>
          )}
        </p>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Total spent</p>
          <p className="mt-1 font-mono text-2xl font-semibold text-ink">{formatCurrency(customer.total_spent)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Orders</p>
          <p className="mt-1 font-mono text-2xl font-semibold text-ink">{customer.order_count}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Last order</p>
          <p className="mt-1 text-sm font-medium text-ink">
            {customer.last_order_at ? formatDate(customer.last_order_at) : 'No orders yet'}
          </p>
        </Card>
      </div>

      <Card className="mt-6 flex flex-wrap items-center justify-between gap-4 p-4">
        <div>
          <p className="text-sm font-medium text-ink">Ordering on account</p>
          <p className="mt-1 max-w-xl text-sm text-slate-500">
            {customer.can_order_on_account
              ? 'This customer can place orders payable on invoice. Stock is committed when they order, and payment is recorded by your team once it reflects.'
              : 'This customer must pay through PayFast before an order is confirmed. Enable this to let them order on invoice instead.'}
          </p>
          {termsError && <p className="mt-2 text-sm text-bad-500">{termsError}</p>}
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={customer.can_order_on_account ? 'approved' : 'expired'} />
          <Button
            variant={customer.can_order_on_account ? 'danger' : 'primary'}
            onClick={() => setConfirmingTerms(true)}
          >
            {customer.can_order_on_account ? 'Disable' : 'Enable'}
          </Button>
        </div>
      </Card>

      {confirmingTerms && (
        <ConfirmDialog
          title={customer.can_order_on_account ? 'Stop account ordering?' : 'Allow ordering on account?'}
          message={
            customer.can_order_on_account
              ? `${customer.company_name || customer.email} will have to pay through PayFast again. Orders already placed on account are unaffected.`
              : `${customer.company_name || customer.email} will be able to place orders without paying first. Stock is committed immediately and you collect payment on invoice.`
          }
          confirmLabel={customer.can_order_on_account ? 'Disable' : 'Enable'}
          onConfirm={applyAccountTerms}
          onCancel={() => setConfirmingTerms(false)}
          loading={savingTerms}
        />
      )}

      <h2 className="mt-8 font-display text-base font-semibold text-ink">Orders</h2>
      {customer.orders.length === 0 ? (
        <div className="mt-3">
          <EmptyState title="No orders yet" description="This customer hasn't placed an order." />
        </div>
      ) : (
        <Card className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Items</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Placed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {customer.orders.map((order) => (
                <tr
                  key={order.id}
                  className="cursor-pointer transition-colors duration-150 hover:bg-slate-50"
                  onClick={() => navigate(`/admin/orders/${order.id}`)}
                >
                  <td className="px-4 py-3 font-mono text-xs text-teal-600">#{order.order_number}</td>
                  <td className="px-4 py-3 text-slate-600">{order.order_items?.length || 0} items</td>
                  <td className="px-4 py-3 font-mono font-medium text-ink">{formatCurrency(order.total_amount)}</td>
                  <td className="px-4 py-3"><SourceBadge source={order.source} /></td>
                  <td className="px-4 py-3"><StatusBadge status={order.status} /></td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(order.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <h2 className="mt-8 font-display text-base font-semibold text-ink">Quotes</h2>
      {customer.quotes.length === 0 ? (
        <div className="mt-3">
          <EmptyState title="No quotes yet" description="This customer hasn't submitted a quote." />
        </div>
      ) : (
        <Card className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Quote</th>
                <th className="px-4 py-3">Items</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Submitted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {customer.quotes.map((quote) => (
                <tr
                  key={quote.id}
                  className="cursor-pointer transition-colors duration-150 hover:bg-slate-50"
                  onClick={() => navigate(`/admin/quotes/${quote.id}`)}
                >
                  <td className="px-4 py-3 font-mono text-xs text-teal-600">#{quote.quote_number}</td>
                  <td className="px-4 py-3 text-slate-600">{quote.quote_items?.length || 0} items</td>
                  <td className="px-4 py-3 font-mono font-medium text-ink">{formatCurrency(quote.total_amount)}</td>
                  <td className="px-4 py-3"><SourceBadge source={quote.source} /></td>
                  <td className="px-4 py-3"><StatusBadge status={quote.status} /></td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(quote.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

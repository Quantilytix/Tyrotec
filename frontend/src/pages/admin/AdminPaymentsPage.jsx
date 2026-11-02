import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getAllPaymentsAdmin, updatePaymentStatus, setPaymentArchived } from '../../api/payments';
import { useAuth } from '../../context/AuthContext';
import { isAdmin } from '../../utils/roles';
import { invoiceLabel } from '../../utils/invoiceNumber';
import { formatCurrency, formatDate } from '../../utils/formatters';
import StatusBadge from '../../components/ui/StatusBadge';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import Card from '../../components/ui/Card';
import ConfirmDialog from '../../components/ui/ConfirmDialog';

// Payments that never counted as money received, so an admin can clear them
// (practice payments, mostly) off this page. Matches the API's rule (044).
const ARCHIVABLE = ['cancelled', 'rejected'];

// "INV-0004" for an invoice, "#57" for an order, linked to its page.
function SaleLink({ payment }) {
  const order = payment.orders;
  return order?.invoice_number ? (
    <Link to={`/admin/invoices/${payment.order_id}`} className="text-teal-600 hover:underline">
      {invoiceLabel(order.invoice_number)}
    </Link>
  ) : (
    <Link to={`/admin/orders/${payment.order_id}`} className="text-teal-600 hover:underline">
      #{order?.order_number}
    </Link>
  );
}

export default function AdminPaymentsPage() {
  const { user } = useAuth();
  const canArchive = isAdmin(user?.role);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [actingId, setActingId] = useState(null);
  const [error, setError] = useState('');
  const [rejectingPayment, setRejectingPayment] = useState(null); // payment | null
  const [archivingPayment, setArchivingPayment] = useState(null); // payment | null

  const load = () => getAllPaymentsAdmin({ archived: showArchived }).then(({ data }) => setPayments(data));

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);

  const handleArchive = async (payment, archived) => {
    setError('');
    setActingId(payment.id);
    try {
      await setPaymentArchived(payment.id, archived);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not update this payment.');
    } finally {
      setActingId(null);
      setArchivingPayment(null);
    }
  };

  const handleReview = async (id, status) => {
    setError('');
    setActingId(id);
    try {
      await updatePaymentStatus(id, status);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not update this payment.');
    } finally {
      setActingId(null);
      setRejectingPayment(null);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">Payments</h1>
          <p className="mt-1 text-sm text-slate-500">
            {showArchived
              ? 'Archived payments. Restore one to show it on the main list again.'
              : 'Payments received against orders and invoices.'}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
          />
          Show archived
        </label>
      </div>

      {error && <p className="mt-4 rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-500">{error}</p>}

      {loading ? (
        <Spinner />
      ) : payments.length === 0 ? (
        <div className="mt-6">
          {showArchived ? (
            <EmptyState title="No archived payments" description="Payments you archive will show up here." />
          ) : (
            <EmptyState title="No payments yet" description="Payments received will show up here." />
          )}
        </div>
      ) : (
        <Card className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Method</th>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Submitted</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payments.map((payment) => (
                <tr key={payment.id}>
                  <td className="px-4 py-3 font-mono text-xs">
                    <SaleLink payment={payment} />
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-ink">{payment.users?.company_name || payment.users?.email}</p>
                    {payment.users?.company_name && (
                      <p className="text-xs text-slate-400">{payment.users.email}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600 capitalize">{payment.method.replace('_', ' ')}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{payment.reference}</td>
                  <td className="px-4 py-3 font-mono font-medium text-ink">{formatCurrency(payment.amount)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={`payment_${payment.status}`} />
                  </td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(payment.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    {payment.status === 'submitted' && (
                      <>
                        <button
                          onClick={() => handleReview(payment.id, 'approved')}
                          disabled={actingId === payment.id}
                          className="text-xs font-medium text-good-500 transition-colors duration-150 hover:underline disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => setRejectingPayment(payment)}
                          disabled={actingId === payment.id}
                          className="ml-3 text-xs font-medium text-bad-500 transition-colors duration-150 hover:underline disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </>
                    )}
                    {canArchive && !showArchived && ARCHIVABLE.includes(payment.status) && (
                      <button
                        onClick={() => setArchivingPayment(payment)}
                        disabled={actingId === payment.id}
                        className="text-xs font-medium text-slate-500 transition-colors duration-150 hover:text-ink hover:underline disabled:opacity-50"
                      >
                        Archive
                      </button>
                    )}
                    {canArchive && showArchived && (
                      <button
                        onClick={() => handleArchive(payment, false)}
                        disabled={actingId === payment.id}
                        className="text-xs font-medium text-teal-600 transition-colors duration-150 hover:underline disabled:opacity-50"
                      >
                        Restore
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {rejectingPayment && (
        <ConfirmDialog
          title="Reject this payment?"
          message={`This marks the payment for order #${rejectingPayment.orders?.order_number} as rejected. The customer can resubmit a new payment afterward. This can't be undone.`}
          confirmLabel="Reject payment"
          onConfirm={() => handleReview(rejectingPayment.id, 'rejected')}
          onCancel={() => setRejectingPayment(null)}
          loading={actingId === rejectingPayment.id}
        />
      )}

      {archivingPayment && (
        <ConfirmDialog
          title="Archive this payment?"
          message={`${formatCurrency(archivingPayment.amount)} from ${archivingPayment.users?.company_name || archivingPayment.users?.email} comes off this list. Nothing is deleted: it stays on its ${archivingPayment.orders?.invoice_number ? 'invoice' : 'order'} and in the activity log, and you can restore it under Show archived.`}
          confirmLabel="Archive payment"
          onConfirm={() => handleArchive(archivingPayment, true)}
          onCancel={() => setArchivingPayment(null)}
          loading={actingId === archivingPayment.id}
        />
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getAllPaymentsAdmin, updatePaymentStatus } from '../../api/payments';
import { formatCurrency, formatDate } from '../../utils/formatters';
import StatusBadge from '../../components/ui/StatusBadge';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import Card from '../../components/ui/Card';
import ConfirmDialog from '../../components/ui/ConfirmDialog';

export default function AdminPaymentsPage() {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState(null);
  const [error, setError] = useState('');
  const [rejectingPayment, setRejectingPayment] = useState(null); // payment | null

  const load = () => getAllPaymentsAdmin().then(({ data }) => setPayments(data));

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

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
      <h1 className="font-display text-xl font-semibold text-ink">Payments</h1>
      <p className="mt-1 text-sm text-slate-500">Payments submitted against approved orders.</p>

      {error && <p className="mt-4 rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-500">{error}</p>}

      {loading ? (
        <Spinner />
      ) : payments.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="No payments yet" description="Submitted customer payments will show up here." />
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
                    <Link to={`/admin/orders/${payment.order_id}`} className="text-teal-600 hover:underline">
                      #{payment.orders?.order_number}
                    </Link>
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
    </div>
  );
}

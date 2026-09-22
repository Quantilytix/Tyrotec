import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCustomerOrders } from '../api/orders';
import { formatCurrency, formatDate } from '../utils/formatters';
import StatusBadge from '../components/ui/StatusBadge';
import Spinner from '../components/ui/Spinner';
import EmptyState from '../components/ui/EmptyState';
import Card from '../components/ui/Card';

export default function OrdersPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    getCustomerOrders()
      .then(({ data }) => setOrders(data))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 className="font-display text-xl font-semibold text-ink">Orders</h1>
      <p className="mt-1 text-sm text-slate-500">Orders converted from your quotes.</p>

      {loading ? (
        <Spinner />
      ) : orders.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No orders yet"
            description="Convert a submitted quote into an order to see it here."
          />
        </div>
      ) : (
        <Card className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Items</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Placed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orders.map((order) => (
                <tr
                  key={order.id}
                  className="cursor-pointer transition-colors duration-150 hover:bg-slate-50"
                  onClick={() => navigate(`/orders/${order.id}`)}
                >
                  <td className="px-4 py-3 font-mono text-xs text-teal-600">#{order.order_number}</td>
                  <td className="px-4 py-3 text-slate-600">{order.order_items?.length || 0} items</td>
                  <td className="px-4 py-3 font-mono font-medium text-ink">{formatCurrency(order.total_amount)}</td>
                  <td className="px-4 py-3"><StatusBadge status={order.status} /></td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(order.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

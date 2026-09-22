import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAllOrdersAdmin, exportOrdersAdmin } from '../../api/orders';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { saveBlobResponse, blobErrorMessage } from '../../utils/downloadFile';
import { isWithinDateRange } from '../../utils/dateRange';
import { matchesSearch, recordSearchParts } from '../../utils/searchFilter';
import { ORDER_STATUS_GROUPS, matchesStatusGroup, statusGroupLabel } from '../../utils/statusLabels';
import ExportModal from '../../components/admin/ExportModal';
import ListFilters from '../../components/admin/ListFilters';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import StatusBadge from '../../components/ui/StatusBadge';
import SourceBadge from '../../components/ui/SourceBadge';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import Card from '../../components/ui/Card';

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sourceFilter, setSourceFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showExport, setShowExport] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    getAllOrdersAdmin()
      .then(({ data }) => setOrders(data))
      .finally(() => setLoading(false));
  }, []);

  const visibleOrders = useMemo(
    () =>
      orders.filter(
        (o) =>
          (sourceFilter === 'all' || o.source === sourceFilter) &&
          matchesStatusGroup(statusFilter, o.status) &&
          matchesSearch(search, recordSearchParts(o, 'order_number'))
      ),
    [orders, sourceFilter, statusFilter, search]
  );

  const isFiltering = Boolean(search) || sourceFilter !== 'all' || statusFilter !== 'all';

  // Spelled out in the export modal so it's clear the file follows the
  // filters on screen, not just the date range chosen in the modal.
  const filterSummary = `${[
    sourceFilter === 'all' ? 'All sources' : `Source: ${sourceFilter}`,
    statusFilter === 'all' ? 'all statuses' : `status: ${statusGroupLabel(statusFilter)}`,
    search ? `search: "${search}"` : null,
  ]
    .filter(Boolean)
    .join(' · ')}.`;

  // Shown in the export modal before committing, so nobody downloads an empty
  // file: the filters on screen, which the export applies too, plus its range.
  const countInRange = (from, to) =>
    visibleOrders.filter((o) => isWithinDateRange(o.created_at, from, to)).length;

  const handleExport = async ({ from, to }) => {
    try {
      const response = await exportOrdersAdmin({
        source: sourceFilter,
        status: statusFilter,
        search: search || undefined,
        from: from || undefined,
        to: to || undefined,
      });
      saveBlobResponse(response, 'orders.xlsx');
    } catch (err) {
      throw new Error(await blobErrorMessage(err, 'Could not export the orders.'));
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">Orders</h1>
          <p className="mt-1 text-sm text-slate-500">Every order placed across all customers.</p>
        </div>
        <Button variant="secondary" onClick={() => setShowExport(true)}>
          Export to Excel
        </Button>
      </div>

      {showExport && (
        <Modal title="Export orders to Excel" onClose={() => setShowExport(false)}>
          <ExportModal
            noun="orders"
            filterSummary={filterSummary}
            countFor={countInRange}
            onExport={handleExport}
            onClose={() => setShowExport(false)}
          />
        </Modal>
      )}

      <ListFilters
        search={search}
        onSearchChange={setSearch}
        source={sourceFilter}
        onSourceChange={setSourceFilter}
        status={statusFilter}
        onStatusChange={setStatusFilter}
        statuses={ORDER_STATUS_GROUPS}
        shown={visibleOrders.length}
        total={orders.length}
        noun="orders"
      />

      {loading ? (
        <Spinner />
      ) : visibleOrders.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title={isFiltering ? 'No orders match these filters' : 'No orders yet'}
            description={
              isFiltering
                ? 'Try a different search, status or source.'
                : 'Orders converted from customer quotes will show up here.'
            }
          />
        </div>
      ) : (
        <Card className="mt-6 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Items</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Placed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleOrders.map((order) => (
                <tr
                  key={order.id}
                  className="cursor-pointer transition-colors duration-150 hover:bg-slate-50"
                  onClick={() => navigate(`/admin/orders/${order.id}`)}
                >
                  <td className="px-4 py-3 font-mono text-xs text-teal-600">#{order.order_number}</td>
                  <td className="px-4 py-3">
                    <p className="text-ink">{order.users?.company_name || order.users?.email}</p>
                    {order.users?.company_name && (
                      <p className="text-xs text-slate-400">{order.users.email}</p>
                    )}
                  </td>
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
    </div>
  );
}

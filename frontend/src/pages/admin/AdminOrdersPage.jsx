import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAllOrdersAdmin, exportOrdersAdmin, downloadInvoicePdf, emailInvoice, updateOrderStatus } from '../../api/orders';
import { CANCELLABLE, canRecordPayment, shortLinesOf, statusMovesFor } from '../../utils/orderActions';
import ActionMenu from '../../components/ui/ActionMenu';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import DeleteToBinDialog from '../../components/admin/DeleteToBinDialog';
import { useAuth } from '../../context/AuthContext';
import { isStaff } from '../../utils/roles';

// A finished sale can't be deleted (046): it's part of the books.
const FINISHED = ['completed', 'ready_for_collection'];
import { formatCurrency, formatDate } from '../../utils/formatters';
import { saveBlobResponse, blobErrorMessage } from '../../utils/downloadFile';
import { isWithinDateRange } from '../../utils/dateRange';
import { matchesSearch, recordSearchParts } from '../../utils/searchFilter';
import { ORDER_STATUS_GROUPS, matchesStatusGroup, statusGroupLabel, orderDisplayStatus } from '../../utils/statusLabels';
import ExportModal from '../../components/admin/ExportModal';
import ListFilters from '../../components/admin/ListFilters';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import StatusBadge from '../../components/ui/StatusBadge';
import SourceBadge from '../../components/ui/SourceBadge';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import Card from '../../components/ui/Card';
import { invoiceLabel } from '../../utils/invoiceNumber';

// kind 'orders': what customers placed on the portal or WhatsApp.
// kind 'invoices': sales staff made from a quote, numbered INV-0001.
export default function AdminOrdersPage({ kind = 'orders' }) {
  const invoices = kind === 'invoices';
  const noun = invoices ? 'invoices' : 'orders';
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sourceFilter, setSourceFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showExport, setShowExport] = useState(false);
  const [notice, setNotice] = useState(null); // { ok, text } | null
  const [cancelling, setCancelling] = useState(null); // order | null
  const [deleting, setDeleting] = useState(null); // order | null
  const navigate = useNavigate();
  const { user } = useAuth();
  // Admins and sales reps (admins are told about a rep's deletes; only admins restore).
  const canDelete = isStaff(user?.role);

  const load = () =>
    getAllOrdersAdmin(kind)
      // invoice_ref: the INV- number, so it can be searched like it's shown.
      .then(({ data }) => setOrders(data.map((o) => (o.invoice_number ? { ...o, invoice_ref: invoiceLabel(o.invoice_number) } : o))));

  useEffect(() => {
    load().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  // A row action's outcome, shown above the table.
  const run = async (work, success, failure) => {
    setNotice(null);
    try {
      await work();
      if (success) setNotice({ ok: true, text: success });
    } catch (err) {
      setNotice({ ok: false, text: err.response?.data?.error || (await blobErrorMessage(err, failure)) });
    }
  };

  const changeStatus = (order, status, success) =>
    run(async () => {
      await updateOrderStatus(order.id, status);
      await load();
    }, success, 'Could not update it.');

  // The everyday actions on a row. The rest (approving, the arrival date,
  // receipts) stay on the order's own page.
  const rowActions = (order) => {
    const page = `/admin/${kind}/${order.id}`;
    const name = order.invoice_number ? order.invoice_ref : `Order #${order.order_number}`;
    const live = order.status !== 'cancelled';
    return [
      { label: 'Open', onClick: () => navigate(page) },
      {
        label: 'Download PDF',
        hidden: !order.invoice_number,
        onClick: () =>
          run(async () => saveBlobResponse(await downloadInvoicePdf(order.id), `${order.invoice_ref}.pdf`), null, 'Could not download the invoice.'),
      },
      {
        label: 'Email to customer',
        hidden: !order.invoice_number || !live,
        onClick: () =>
          run(async () => {
            const { data } = await emailInvoice(order.id);
            return data;
          }, `${name} emailed to ${order.users?.email}.`, 'Could not email the invoice.'),
      },
      { divider: true },
      { label: 'Record payment', hidden: !canRecordPayment(order), onClick: () => navigate(`${page}?action=record-payment`) },
      { label: 'Stock received…', hidden: shortLinesOf(order).length === 0, onClick: () => navigate(`${page}?action=receive-stock`) },
      ...statusMovesFor(order).map((move) => ({
        label: move.label,
        onClick: () => changeStatus(order, move.status, `${name} updated: ${move.label}.`),
      })),
      { divider: true },
      { label: `Cancel ${invoices ? 'invoice' : 'order'}`, danger: true, hidden: !CANCELLABLE.includes(order.status), onClick: () => setCancelling(order) },
      // Admins; never a finished sale (it's in the books).
      { label: 'Delete', danger: true, hidden: !canDelete || FINISHED.includes(order.status), onClick: () => setDeleting(order) },
    ];
  };

  const visibleOrders = useMemo(
    () =>
      orders.filter(
        (o) =>
          (sourceFilter === 'all' || o.source === sourceFilter) &&
          matchesStatusGroup(statusFilter, orderDisplayStatus(o)) &&
          matchesSearch(search, recordSearchParts(o, invoices ? 'invoice_ref' : 'order_number'))
      ),
    [orders, sourceFilter, statusFilter, search]
  );

  const isFiltering = Boolean(search) || sourceFilter !== 'all' || statusFilter !== 'all';

  // Spelled out in the export modal so it's clear the file follows the
  // filters on screen, not just the date range chosen in the modal.
  const filterSummary = `${[
    invoices ? null : sourceFilter === 'all' ? 'All sources' : `Source: ${sourceFilter}`,
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
        kind,
        source: sourceFilter,
        search: search || undefined,
        from: from || undefined,
        to: to || undefined,
      });
      saveBlobResponse(response, `${noun}.xlsx`);
    } catch (err) {
      throw new Error(await blobErrorMessage(err, `Could not export the ${noun}.`));
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">{invoices ? 'Invoices' : 'Orders'}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {invoices
              ? 'Invoices staff made for customers from their quotes.'
              : 'Orders customers placed on the portal or WhatsApp.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => setShowExport(true)}>
            Export to Excel
          </Button>
          {invoices && <Button onClick={() => navigate('/admin/invoices/new')}>New invoice</Button>}
        </div>
      </div>

      {showExport && (
        <Modal title={`Export ${noun} to Excel`} onClose={() => setShowExport(false)}>
          <ExportModal
            noun={noun}
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
        noun={noun}
        // Staff-made sales are on the Invoices page, so Orders only offers
        // the customers' own channels.
        sources={invoices ? [] : ['portal', 'whatsapp']}
      />

      {notice && (
        <p className={`mt-4 rounded-lg px-3 py-2 text-sm ${notice.ok ? 'bg-good-50 text-good-500' : 'bg-bad-50 text-bad-500'}`}>
          {notice.text}
        </p>
      )}

      {cancelling && (
        <ConfirmDialog
          title={`Cancel ${cancelling.invoice_ref || `order #${cancelling.order_number}`}?`}
          message={
            cancelling.payments?.some((p) => p.status === 'approved' || p.status === 'submitted')
              ? "It will be cancelled, its payment marked cancelled (not paid) and any reserved stock restored. Refund the customer separately. This can't be undone."
              : "It will be cancelled and any reserved stock restored. This can't be undone."
          }
          confirmLabel={`Cancel ${invoices ? 'invoice' : 'order'}`}
          onConfirm={async () => {
            const order = cancelling;
            setCancelling(null);
            await changeStatus(order, 'cancelled', `${order.invoice_ref || `Order #${order.order_number}`} cancelled.`);
          }}
          onCancel={() => setCancelling(null)}
        />
      )}

      {deleting && (
        <DeleteToBinDialog
          type="order"
          id={deleting.id}
          name={deleting.invoice_ref || `order #${deleting.order_number}`}
          what={
            deleting.status === 'cancelled'
              ? ''
              : `It isn't cancelled yet, so deleting cancels it first: its stock goes back${
                  deleting.payments?.some((p) => p.status === 'approved' || p.status === 'submitted')
                    ? ' and its payment is marked cancelled (refund the customer separately)'
                    : ''
                }. The customer isn't told; use Cancel instead if they should be.`
          }
          onDeleted={async () => {
            const name = deleting.invoice_ref || `Order #${deleting.order_number}`;
            setDeleting(null);
            setNotice({ ok: true, text: `${name} moved to Recently deleted.` });
            await load();
          }}
          onCancel={() => setDeleting(null)}
        />
      )}

      {loading ? (
        <Spinner />
      ) : visibleOrders.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title={isFiltering ? `No ${noun} match these filters` : `No ${noun} yet`}
            description={
              isFiltering
                ? `Try a different search, status${invoices ? '' : ' or source'}.`
                : invoices
                  ? 'Use New invoice, or Convert to invoice on a quote, to make one.'
                  : 'Orders customers place from their quotes will show up here.'
            }
          />
        </div>
      ) : (
        <Card className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">{invoices ? 'Invoice' : 'Order'}</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Items</th>
                <th className="px-4 py-3">Total</th>
                {!invoices && <th className="px-4 py-3">Source</th>}
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">{invoices ? 'Date' : 'Placed'}</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleOrders.map((order) => (
                <tr
                  key={order.id}
                  className="cursor-pointer transition-colors duration-150 hover:bg-slate-50"
                  onClick={() => navigate(`/admin/${kind}/${order.id}`)}
                >
                  <td className="px-4 py-3 font-mono text-xs text-teal-600">
                    {invoices ? order.invoice_ref : `#${order.order_number}`}
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-ink">{order.users?.company_name || order.users?.email}</p>
                    {order.users?.company_name && (
                      <p className="text-xs text-slate-400">{order.users.email}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{order.order_items?.length || 0} items</td>
                  <td className="px-4 py-3 font-mono font-medium text-ink">{formatCurrency(order.total_amount)}</td>
                  {!invoices && <td className="px-4 py-3"><SourceBadge source={order.source} /></td>}
                  <td className="px-4 py-3"><StatusBadge status={orderDisplayStatus(order)} /></td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(order.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <ActionMenu items={rowActions(order)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

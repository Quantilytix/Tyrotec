import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getRecentlyDeleted, restoreRecord } from '../../api/recentlyDeleted';
import { formatCurrency, formatDate, formatSaDay } from '../../utils/formatters';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import Card from '../../components/ui/Card';

// Admin only. What was deleted in the last 30 days, from any list's Actions
// menu, and Restore. After 30 days a quote or customer is gone for good; an
// order, invoice or purchase only leaves the portal -- it stays in the
// records, which the books and SARS need (046_recently_deleted.sql).
const KINDS = [
  { value: 'all', label: 'Everything' },
  { value: 'quote', label: 'Quotes' },
  { value: 'order', label: 'Orders & invoices' },
  { value: 'purchase', label: 'Purchases' },
  { value: 'customer', label: 'Customers' },
];

function kindOf(item) {
  if (item.type === 'order') return item.name.startsWith('Invoice') ? 'Invoice' : 'Order';
  return { quote: 'Quote', purchase: 'Purchase', customer: 'Customer' }[item.type];
}

// Where a restored record lives.
function pageOf(item) {
  if (item.type === 'order') return `/admin/${item.name.startsWith('Invoice') ? 'invoices' : 'orders'}/${item.id}`;
  return { quote: `/admin/quotes/${item.id}`, purchase: `/admin/purchases/${item.id}`, customer: `/admin/customers/${item.id}` }[item.type];
}

export default function AdminRecentlyDeletedPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState('all');
  const [restoringId, setRestoringId] = useState(null);
  const [notice, setNotice] = useState(null); // { ok, text, link? } | null

  useEffect(() => {
    getRecentlyDeleted()
      .then(({ data }) => setItems(data.data))
      .finally(() => setLoading(false));
  }, []);

  const shown = useMemo(() => items.filter((i) => kind === 'all' || i.type === kind), [items, kind]);

  const restore = async (item) => {
    setNotice(null);
    setRestoringId(item.id);
    try {
      await restoreRecord(item.type, item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setNotice({
        ok: true,
        text: `${item.name} restored${item.type === 'order' ? ' (it comes back cancelled)' : ''}.`,
        link: pageOf(item),
      });
    } catch (err) {
      setNotice({ ok: false, text: err.response?.data?.error || `Could not restore ${item.name}.` });
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">Recently deleted</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Anything deleted in the last 30 days. Restore it here. After 30 days, quotes and customers are deleted for
            good; orders, invoices and purchases leave the portal but stay in your records, for your books and SARS.
          </p>
        </div>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-teal-500"
        >
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </div>

      {notice && (
        <p className={`mt-4 rounded-lg px-3 py-2 text-sm ${notice.ok ? 'bg-good-50 text-good-500' : 'bg-bad-50 text-bad-500'}`}>
          {notice.text}{' '}
          {notice.link && (
            <Link to={notice.link} className="font-medium underline">
              Open it
            </Link>
          )}
        </p>
      )}

      {loading ? (
        <Spinner />
      ) : shown.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="Nothing here" description="Things you delete from an Actions menu show up here for 30 days." />
        </div>
      ) : (
        <Card className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">What</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Deleted</th>
                <th className="px-4 py-3">After 30 days</th>
                <th className="px-4 py-3 text-right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((item) => (
                <tr key={`${item.type}-${item.id}`}>
                  <td className="px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-slate-400">{kindOf(item)}</p>
                    <p className="font-medium text-ink">{item.name}</p>
                    {item.party && <p className="text-xs text-slate-400">{item.party}</p>}
                  </td>
                  <td className="px-4 py-3 font-mono text-ink">{item.amount === null ? '' : formatCurrency(item.amount)}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {formatDate(item.deleted_at)}
                    {item.deleted_by && <p className="text-xs text-slate-400">by {item.deleted_by}</p>}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {item.kept ? 'Kept in your records; leaves this list' : 'Deleted for good'} on {formatSaDay(item.leaves_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => restore(item)}
                      disabled={restoringId === item.id}
                      className="text-xs font-medium text-teal-600 transition-colors duration-150 hover:underline disabled:opacity-50"
                    >
                      {restoringId === item.id ? 'Restoring…' : 'Restore'}
                    </button>
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

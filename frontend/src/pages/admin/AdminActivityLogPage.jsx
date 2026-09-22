import { useCallback, useEffect, useState } from 'react';
import { getActivityLog, getActivityActions } from '../../api/activityLog';
import { formatDate } from '../../utils/formatters';
import { roleLabel } from '../../utils/roles';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';

const LIMIT = 50;

// Two views of the same trail, because they answer different questions:
// "what has my team been doing" and "what has this customer been doing".
// Automated actors (the PayFast webhook, the reservation jobs) sit with staff
// activity -- they're the business's own side, not something a customer did.
const TABS = [
  { key: 'staff', label: 'Staff activity', blurb: 'What staff and automated processes did.' },
  { key: 'customer', label: 'Customer activity', blurb: 'What customers did in the portal and on WhatsApp.' },
];

const ROLE_STYLES = {
  super_admin: 'bg-teal-50 text-teal-600',
  admin: 'bg-teal-50 text-teal-600',
  sales_rep: 'bg-amber-50 text-amber-600',
  customer: 'bg-slate-100 text-slate-500',
  system: 'bg-slate-100 text-slate-500',
};

// 'order.status_changed' -> 'Order status changed'
function actionLabel(action) {
  const text = String(action || '').replace(/[._]/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const CONTROL =
  'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-teal-500';

// Admin and above -- see backend/src/routes/activityLogRoutes.js. Deliberately
// not shown to sales_rep accounts, since part of its purpose is oversight of
// what they (and other admins) have done.
export default function AdminActivityLogPage() {
  const [audience, setAudience] = useState('staff');
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [entries, setEntries] = useState([]);
  const [actions, setActions] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const filters = useCallback(
    (pageNumber) => ({
      page: pageNumber,
      limit: LIMIT,
      audience,
      action: action || undefined,
      search: search || undefined,
      from: from || undefined,
      to: to || undefined,
    }),
    [audience, action, search, from, to]
  );

  useEffect(() => {
    getActivityActions()
      .then(({ data }) => setActions(data))
      .catch(() => setActions([]));
  }, []);

  useEffect(() => {
    setLoading(true);
    // Debounced: the search box refiltered on every keystroke otherwise.
    const timeout = setTimeout(() => {
      getActivityLog(filters(1))
        .then(({ data }) => {
          setEntries(data.data);
          setTotal(data.total);
          setPage(1);
        })
        .catch(() => setError('Could not load the activity log.'))
        .finally(() => setLoading(false));
    }, 300);

    return () => clearTimeout(timeout);
  }, [filters]);

  const handleLoadMore = async () => {
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const { data } = await getActivityLog(filters(nextPage));
      setEntries((prev) => [...prev, ...data.data]);
      setPage(nextPage);
    } catch {
      setError('Could not load more entries.');
    } finally {
      setLoadingMore(false);
    }
  };

  const isFiltering = Boolean(search || action || from || to);
  const activeTab = TABS.find((tab) => tab.key === audience);

  return (
    <div>
      <h1 className="font-display text-xl font-semibold text-ink">Audit log</h1>
      <p className="mt-1 text-sm text-slate-500">
        Every significant action across the app, kept for oversight. Visible to admins only.
      </p>

      <div className="mt-6 flex gap-1 border-b border-slate-200">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setAudience(tab.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors duration-150 ${
              audience === tab.key
                ? 'border-teal-500 text-ink'
                : 'border-transparent text-slate-500 hover:text-ink'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-500">{activeTab?.blurb}</p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by person or description"
          className={`${CONTROL} w-full flex-1 sm:w-auto sm:min-w-[18rem]`}
        />
        <select value={action} onChange={(e) => setAction(e.target.value)} className={CONTROL}>
          <option value="">All actions</option>
          {actions.map((value) => (
            <option key={value} value={value}>
              {actionLabel(value)}
            </option>
          ))}
        </select>
        <label className="text-xs text-slate-500" htmlFor="log-from">
          From
        </label>
        <input id="log-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={CONTROL} />
        <label className="text-xs text-slate-500" htmlFor="log-to">
          To
        </label>
        <input id="log-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={CONTROL} />
        {isFiltering && (
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setAction('');
              setFrom('');
              setTo('');
            }}
            className="text-xs font-medium text-teal-600 transition-colors duration-150 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {error && <p className="mt-4 rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-500">{error}</p>}

      {loading ? (
        <Spinner />
      ) : entries.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title={isFiltering ? 'Nothing matches these filters' : 'No activity yet'}
            description={
              isFiltering
                ? 'Try a different search, action or date range.'
                : `${activeTab?.label} will show up here as it happens.`
            }
          />
        </div>
      ) : (
        <>
          <p className="mt-4 text-xs text-slate-500">
            Showing {entries.length} of {total}
          </p>
          <Card className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Who</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">What happened</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">{formatDate(entry.created_at)}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <p className="text-ink">{entry.actor_label}</p>
                      {entry.actor_role && (
                        <span
                          className={`mt-0.5 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            ROLE_STYLES[entry.actor_role] || ROLE_STYLES.system
                          }`}
                        >
                          {entry.actor_role === 'system' ? 'Automated' : roleLabel(entry.actor_role)}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-500">{actionLabel(entry.action)}</td>
                    <td className="px-4 py-3 text-slate-600">{entry.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {entries.length < total && (
            <div className="mt-4 flex justify-center">
              <Button variant="secondary" onClick={handleLoadMore} loading={loadingMore}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

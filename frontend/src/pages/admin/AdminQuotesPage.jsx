import { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { getAllQuotesAdmin, exportQuotesAdmin } from '../../api/quotes';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { saveBlobResponse, blobErrorMessage } from '../../utils/downloadFile';
import { isWithinDateRange } from '../../utils/dateRange';
import { matchesSearch, recordSearchParts } from '../../utils/searchFilter';
import { QUOTE_STATUSES, statusLabel } from '../../utils/statusLabels';
import ExportModal from '../../components/admin/ExportModal';
import ListFilters from '../../components/admin/ListFilters';
import Modal from '../../components/ui/Modal';
import StatusBadge from '../../components/ui/StatusBadge';
import SourceBadge from '../../components/ui/SourceBadge';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';

export default function AdminQuotesPage() {
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sourceFilter, setSourceFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showExport, setShowExport] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    getAllQuotesAdmin()
      .then(({ data }) => setQuotes(data))
      .finally(() => setLoading(false));
  }, []);

  const visibleQuotes = useMemo(
    () =>
      quotes.filter(
        (q) =>
          (sourceFilter === 'all' || q.source === sourceFilter) &&
          (statusFilter === 'all' || q.status === statusFilter) &&
          matchesSearch(search, recordSearchParts(q, 'quote_number'))
      ),
    [quotes, sourceFilter, statusFilter, search]
  );

  // Shown in the export modal before committing, so nobody downloads an empty
  // file: the filters on screen, which the export applies too, plus its range.
  const countInRange = (from, to) =>
    visibleQuotes.filter((q) => isWithinDateRange(q.created_at, from, to)).length;

  const isFiltering = Boolean(search) || sourceFilter !== 'all' || statusFilter !== 'all';

  // Spelled out in the export modal so it's clear the file follows the
  // filters on screen, not just the date range chosen in the modal.
  const filterSummary = `${[
    sourceFilter === 'all' ? 'All sources' : `Source: ${sourceFilter}`,
    statusFilter === 'all' ? 'all statuses' : `status: ${statusLabel(statusFilter)}`,
    search ? `search: "${search}"` : null,
  ]
    .filter(Boolean)
    .join(' · ')}.`;

  const handleExport = async ({ from, to }) => {
    try {
      const response = await exportQuotesAdmin({
        source: sourceFilter,
        status: statusFilter,
        search: search || undefined,
        from: from || undefined,
        to: to || undefined,
      });
      saveBlobResponse(response, 'quotes.xlsx');
    } catch (err) {
      throw new Error(await blobErrorMessage(err, 'Could not export the quotes.'));
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">Quotes</h1>
          <p className="mt-1 text-sm text-slate-500">Every quote submitted across all customers.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={() => setShowExport(true)}>
            Export to Excel
          </Button>
          <Link to="/admin/quotes/new">
            <Button>New quote</Button>
          </Link>
        </div>
      </div>

      {showExport && (
        <Modal title="Export quotes to Excel" onClose={() => setShowExport(false)}>
          <ExportModal
            noun="quotes"
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
        statuses={QUOTE_STATUSES}
        shown={visibleQuotes.length}
        total={quotes.length}
        noun="quotes"
      />

      {loading ? (
        <Spinner />
      ) : visibleQuotes.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title={isFiltering ? 'No quotes match these filters' : 'No quotes yet'}
            description={
              isFiltering
                ? 'Try a different search, status or source.'
                : 'Submitted customer quotes will show up here.'
            }
          />
        </div>
      ) : (
        <Card className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Quote</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Items</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Submitted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleQuotes.map((quote) => (
                <tr
                  key={quote.id}
                  className="cursor-pointer transition-colors duration-150 hover:bg-slate-50"
                  onClick={() => navigate(`/admin/quotes/${quote.id}`)}
                >
                  <td className="px-4 py-3 font-mono text-xs text-teal-600">#{quote.quote_number}</td>
                  <td className="px-4 py-3">
                    <p className="text-ink">{quote.users?.company_name || quote.users?.email}</p>
                    {quote.users?.company_name && (
                      <p className="text-xs text-slate-400">{quote.users.email}</p>
                    )}
                  </td>
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

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getCustomerQuotes } from '../api/quotes';
import { formatCurrency, formatDate } from '../utils/formatters';
import StatusBadge from '../components/ui/StatusBadge';
import Spinner from '../components/ui/Spinner';
import EmptyState from '../components/ui/EmptyState';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';

export default function QuotesPage() {
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    getCustomerQuotes()
      .then(({ data }) => setQuotes(data))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 className="font-display text-xl font-semibold text-ink">Quotes</h1>
      <p className="mt-1 text-sm text-slate-500">Quotes you've submitted, and their status.</p>

      {loading ? (
        <Spinner />
      ) : quotes.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No quotes yet"
            description="Add products to a quote from the catalog to get started."
            action={
              <Link to="/products">
                <Button>Browse products</Button>
              </Link>
            }
          />
        </div>
      ) : (
        <Card className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Quote</th>
                <th className="px-4 py-3">Items</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Submitted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {quotes.map((quote) => (
                <tr
                  key={quote.id}
                  className="cursor-pointer transition-colors duration-150 hover:bg-slate-50"
                  onClick={() => navigate(`/quotes/${quote.id}`)}
                >
                  <td className="px-4 py-3 font-mono text-xs text-teal-600">#{quote.quote_number}</td>
                  <td className="px-4 py-3 text-slate-600">{quote.quote_items?.length || 0} items</td>
                  <td className="px-4 py-3 font-mono font-medium text-ink">{formatCurrency(quote.total_amount)}</td>
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

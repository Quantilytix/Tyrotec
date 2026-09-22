import { useEffect, useState } from 'react';
import { getAnalyticsSummary } from '../../api/analytics';
import { formatCurrency } from '../../utils/formatters';
import Spinner from '../../components/ui/Spinner';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';

const toDateStr = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => toDateStr(new Date(Date.now() - n * 24 * 60 * 60 * 1000));
const todayStr = () => toDateStr(new Date());

const PRESETS = [
  { label: 'Last 7 days', from: () => daysAgo(6), to: todayStr },
  { label: 'Last 30 days', from: () => daysAgo(29), to: todayStr },
  { label: 'Last 90 days', from: () => daysAgo(89), to: todayStr },
  { label: 'This year', from: () => `${new Date().getFullYear()}-01-01`, to: todayStr },
  // 3 years comfortably covers everything for an app this young without
  // zero-filling the revenue chart across an unbounded/arbitrary history.
  { label: 'All time', from: () => daysAgo(3 * 365), to: todayStr },
];

const DATE_INPUT_CLASS =
  'rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-teal-500';

function DateRangeFilter({ from, to, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {PRESETS.map((p) => (
        <Button key={p.label} variant="secondary" onClick={() => onChange(p.from(), p.to())}>
          {p.label}
        </Button>
      ))}
      <div className="ml-2 flex items-center gap-2">
        <input
          type="date"
          value={from}
          max={to}
          onChange={(e) => onChange(e.target.value, to)}
          className={DATE_INPUT_CLASS}
        />
        <span className="text-sm text-slate-400">to</span>
        <input
          type="date"
          value={to}
          min={from}
          max={todayStr()}
          onChange={(e) => onChange(from, e.target.value)}
          className={DATE_INPUT_CLASS}
        />
      </div>
    </div>
  );
}

const ACCENT_CLASSES = {
  navy: 'border-l-teal-500',
  maroon: 'border-l-maroon-500',
  gold: 'border-l-yellow-500',
  good: 'border-l-good-500',
};

function StatTile({ label, value, accent = 'navy' }) {
  return (
    <Card className={`border-l-4 p-4 ${ACCENT_CLASSES[accent]}`}>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 font-mono text-2xl font-semibold text-ink">{value}</p>
    </Card>
  );
}

// Single-hue sequential bars for a magnitude comparison -- one series, so no
// legend needed (the section title already says what's plotted). Value sits
// at the bar's tip, per the dataviz skill's mark spec.
function BarList({ items, labelKey, valueKey, formatValue }) {
  const max = Math.max(...items.map((i) => i[valueKey]), 1);

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item[labelKey]} className="flex items-center gap-3">
          <p className="w-40 shrink-0 truncate text-sm text-slate-600" title={item[labelKey]}>
            {item[labelKey]}
          </p>
          <div className="flex flex-1 items-center gap-2">
            <div className="h-4 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-teal-500"
                style={{ width: `${Math.max((item[valueKey] / max) * 100, 3)}%` }}
              />
            </div>
            <p className="w-20 shrink-0 text-right font-mono text-xs text-ink">{formatValue(item[valueKey])}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// Two-segment horizontal bar (e.g. portal vs whatsapp) with a small legend --
// same one-glance-comparison intent as BarList, but for a part-to-whole split
// rather than a ranked magnitude list.
function SplitBar({ label, a, b, aLabel, bLabel }) {
  const total = a + b || 1;
  const aPct = (a / total) * 100;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
        <p>{label}</p>
        <p className="font-mono text-xs text-slate-500">{a + b} total</p>
      </div>
      <div className="mt-2 flex h-4 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full bg-teal-500" style={{ width: `${aPct}%` }} />
        <div className="h-full bg-yellow-500" style={{ width: `${100 - aPct}%` }} />
      </div>
      <div className="mt-1.5 flex items-center gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-teal-500" /> {aLabel} ({a})
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-yellow-500" /> {bLabel} ({b})
        </span>
      </div>
    </div>
  );
}

// Hand-rolled inline SVG area chart -- no charting library is installed and
// this is the only chart in the app, so pulling one in for a single polyline
// isn't worth the dependency. Fixed viewBox, scaled to fit; renders a flat
// zero line rather than crashing when there's no revenue yet.
function RevenueTrendChart({ data, rangeLabel }) {
  const width = 720;
  const height = 220;
  const padding = { top: 16, right: 16, bottom: 28, left: 16 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const max = Math.max(...data.map((d) => d.revenue), 1);
  const points = data.map((d, i) => {
    const x = padding.left + (i / Math.max(data.length - 1, 1)) * innerW;
    const y = padding.top + innerH - (d.revenue / max) * innerH;
    return { x, y, ...d };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaPath = `${linePath} L${points[points.length - 1].x},${padding.top + innerH} L${points[0].x},${padding.top + innerH} Z`;

  const peak = points.reduce((best, p) => (p.revenue > best.revenue ? p : best), points[0]);
  const formatDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={`Revenue from ${rangeLabel}`}>
      <defs>
        <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-teal-500)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="var(--color-teal-500)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#revenueFill)" />
      <path d={linePath} fill="none" stroke="var(--color-teal-500)" strokeWidth="2" />
      {max > 1 && (
        <circle cx={peak.x} cy={peak.y} r="3.5" fill="var(--color-teal-500)" />
      )}
      <text x={points[0].x} y={height - 8} className="fill-slate-400 text-[10px]">
        {formatDate(points[0].date)}
      </text>
      <text x={points[points.length - 1].x} y={height - 8} textAnchor="end" className="fill-slate-400 text-[10px]">
        {formatDate(points[points.length - 1].date)}
      </text>
      {max > 1 && (
        <text x={peak.x} y={Math.max(peak.y - 8, 10)} textAnchor="middle" className="fill-ink text-[10px] font-medium">
          {formatCurrency(peak.revenue)}
        </text>
      )}
    </svg>
  );
}

export default function AdminAnalyticsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(() => daysAgo(29));
  const [to, setTo] = useState(todayStr);

  useEffect(() => {
    setLoading(true);
    getAnalyticsSummary({ from, to })
      .then(({ data }) => {
        setData(data);
        // Sync back in case the backend collapsed a swapped/invalid range --
        // keeps the visible inputs truthful to what was actually applied.
        setFrom(data.range.from);
        setTo(data.range.to);
      })
      .finally(() => setLoading(false));
  }, [from, to]);

  if (loading && !data) return <Spinner />;
  if (!data) return <p className="text-sm text-slate-500">Could not load analytics.</p>;

  const { quoteFunnel, orderFunnel, revenue, revenueOverTime, payments, sourceBreakdown, topProducts, topCategories, customers, range } = data;
  const rangeLabel = `${range.from} to ${range.to}`;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">Analytics</h1>
          <p className="mt-1 text-sm text-slate-500">Revenue, order health, top sellers, and customer activity.</p>
        </div>
        <DateRangeFilter from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
      </div>

      <div className={`transition-opacity duration-200 ${loading ? 'opacity-60' : 'opacity-100'}`}>
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Total revenue" value={formatCurrency(revenue.total)} accent="navy" />
        <StatTile label="Avg order value" value={formatCurrency(revenue.averageOrderValue)} accent="navy" />
        <StatTile label="Conversion rate" value={`${Math.round(quoteFunnel.conversionRate * 100)}%`} accent="gold" />
        <StatTile label="Customers" value={customers.total} accent="gold" />
        <StatTile label="New customers" value={customers.newCustomersInRange} accent="gold" />
        <StatTile label="Payments collected" value={formatCurrency(payments.collected.amount)} accent="good" />
      </div>

      <Card className="mt-6 p-5">
        <h2 className="font-display text-base font-semibold text-ink">Revenue: {rangeLabel}</h2>
        <p className="mt-1 text-xs text-slate-500">Non-cancelled orders, by day placed.</p>
        <div className="mt-4">
          <RevenueTrendChart data={revenueOverTime} rangeLabel={rangeLabel} />
        </div>
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-display text-base font-semibold text-ink">Quote funnel</h2>
          <p className="mt-1 text-xs text-slate-500">Submitted quotes by current status.</p>
          <div className="mt-4">
            <BarList
              items={[
                { name: 'Submitted', value: quoteFunnel.counts.submitted },
                { name: 'Converted', value: quoteFunnel.counts.converted },
                { name: 'Expired', value: quoteFunnel.counts.expired },
              ]}
              labelKey="name"
              valueKey="value"
              formatValue={(v) => String(v)}
            />
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-display text-base font-semibold text-ink">Order funnel</h2>
          <p className="mt-1 text-xs text-slate-500">All orders by current status.</p>
          <div className="mt-4">
            <BarList
              items={[
                { name: 'Pending approval', value: orderFunnel.counts.pending_approval },
                { name: 'Approved', value: orderFunnel.counts.approved },
                { name: 'Processing', value: orderFunnel.counts.processing },
                { name: 'Completed', value: orderFunnel.counts.completed },
                { name: 'Cancelled', value: orderFunnel.counts.cancelled },
              ]}
              labelKey="name"
              valueKey="value"
              formatValue={(v) => String(v)}
            />
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-display text-base font-semibold text-ink">Top categories</h2>
          <p className="mt-1 text-xs text-slate-500">By revenue from order line items.</p>
          <div className="mt-4">
            {topCategories.length === 0 ? (
              <p className="text-sm text-slate-500">No order data yet.</p>
            ) : (
              <BarList
                items={topCategories}
                labelKey="category"
                valueKey="revenue"
                formatValue={formatCurrency}
              />
            )}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-display text-base font-semibold text-ink">Top products</h2>
          <p className="mt-1 text-xs text-slate-500">By revenue from order line items.</p>
          <div className="mt-4">
            {topProducts.length === 0 ? (
              <p className="text-sm text-slate-500">No order data yet.</p>
            ) : (
              <BarList items={topProducts} labelKey="name" valueKey="revenue" formatValue={formatCurrency} />
            )}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-display text-base font-semibold text-ink">Portal vs WhatsApp</h2>
          <p className="mt-1 text-xs text-slate-500">Where quotes and orders come from.</p>
          <div className="mt-4 space-y-5">
            <SplitBar
              label="Quotes"
              a={sourceBreakdown.quotes.portal}
              b={sourceBreakdown.quotes.whatsapp}
              aLabel="Portal"
              bLabel="WhatsApp"
            />
            <SplitBar
              label="Orders"
              a={sourceBreakdown.orders.portal}
              b={sourceBreakdown.orders.whatsapp}
              aLabel="Portal"
              bLabel="WhatsApp"
            />
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-display text-base font-semibold text-ink">Payment health</h2>
          <p className="mt-1 text-xs text-slate-500">Bank-transfer/EFT submissions by review status.</p>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatTile label="Collected" value={formatCurrency(payments.collected.amount)} accent="good" />
            <StatTile label="Pending review" value={payments.pendingReview.count} accent="gold" />
            <StatTile label="Rejected" value={payments.rejected.count} accent="maroon" />
          </div>
        </Card>
      </div>

      <Card className="mt-6 p-5">
        <h2 className="font-display text-base font-semibold text-ink">Top customers</h2>
        <p className="mt-1 text-xs text-slate-500">By spend in the selected range (cancelled orders excluded).</p>
        {customers.topBySpend.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">No customers yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="pb-2">Customer</th>
                  <th className="pb-2 text-right">Orders</th>
                  <th className="pb-2 text-right">Spent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {customers.topBySpend.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2 text-ink">{c.company_name || c.email}</td>
                    <td className="py-2 text-right text-slate-600">{c.order_count}</td>
                    <td className="py-2 text-right font-mono text-ink">{formatCurrency(c.total_spent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      </div>
    </div>
  );
}

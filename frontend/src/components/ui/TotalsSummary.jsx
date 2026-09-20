import { formatCurrency } from '../../utils/formatters';

// The subtotal / VAT / total block shown under every quote, order and cart.
//
// `totals` comes from displayTotals(), which also flags a legacy document --
// one priced back when prices included VAT. Those show the same three lines
// (worked back out of the inclusive total) plus a note, so an old document
// never looks like it's missing VAT.
export default function TotalsSummary({ totals, className = '' }) {
  return (
    <div className={`text-right ${className}`}>
      <div className="flex items-center justify-end gap-6 text-sm text-slate-500">
        <span>Subtotal (excl. VAT)</span>
        <span className="w-32 font-mono text-ink">{formatCurrency(totals.subtotal_amount)}</span>
      </div>
      <div className="mt-1 flex items-center justify-end gap-6 text-sm text-slate-500">
        <span>VAT</span>
        <span className="w-32 font-mono text-ink">{formatCurrency(totals.vat_amount)}</span>
      </div>
      <div className="mt-2 flex items-center justify-end gap-6 border-t border-slate-100 pt-2">
        <span className="text-xs uppercase tracking-wide text-slate-500">Total (incl. VAT)</span>
        <span className="w-32 font-mono text-2xl font-semibold text-ink">
          {formatCurrency(totals.total_amount)}
        </span>
      </div>
      {totals.legacy && (
        <p className="mt-1 text-xs text-slate-400">Priced when prices included VAT.</p>
      )}
    </div>
  );
}

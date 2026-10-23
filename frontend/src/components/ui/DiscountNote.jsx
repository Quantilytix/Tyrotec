import { formatCurrency } from '../../utils/formatters';
import { discountLabel } from '../../utils/discounts';

// Under a quote/order/cart line's product name: what the discount was and
// the price before it. Renders nothing for an undiscounted line.
export default function DiscountNote({ line }) {
  if (!line?.discount_percent) return null;
  return (
    <p className="mt-1 text-xs text-good-500">
      {discountLabel(line.discount_percent, line.discount_reason)}
      {line.list_price != null && (
        <span className="text-slate-400">
          {' '}
          · was <span className="line-through">{formatCurrency(line.list_price)}</span>
        </span>
      )}
    </p>
  );
}

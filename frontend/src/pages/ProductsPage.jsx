import { useEffect, useState } from 'react';
import { getProducts } from '../api/products';
import useCategories from '../hooks/useCategories';
import { useCart } from '../context/CartContext';
import { formatCurrency, formatDay } from '../utils/formatters';
import { availabilityNote } from '../utils/availability';
import { discountLabel } from '../utils/discounts';
import Button from '../components/ui/Button';
import Spinner from '../components/ui/Spinner';
import EmptyState from '../components/ui/EmptyState';
import Card from '../components/ui/Card';
import ProductImageViewer, { PlaceholderIcon } from '../components/ui/ProductImageViewer';
import Pagination from '../components/ui/Pagination';

export default function ProductsPage() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  // "Deals only": just the products with a current discount. Works with the
  // category and search, e.g. deals in one category.
  const [dealsOnly, setDealsOnly] = useState(false);
  const [dealCount, setDealCount] = useState(0);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;
  const { categories } = useCategories();
  const { addItem, items } = useCart();
  const [quantities, setQuantities] = useState({});
  // The product whose full photo is open, or null.
  const [viewing, setViewing] = useState(null);

  // How many products are on discount, for the banner. Hidden when none are.
  useEffect(() => {
    getProducts({ discounted: true, limit: 1 })
      .then(({ data }) => setDealCount(data.total || 0))
      .catch(() => setDealCount(0));
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setLoading(true);
      getProducts({ search, category: category || undefined, discounted: dealsOnly, page, limit })
        .then(({ data }) => {
          setProducts(data.data);
          setTotal(data.total);
        })
        .finally(() => setLoading(false));
    }, 300); // debounce search input

    return () => clearTimeout(timeout);
  }, [search, category, dealsOnly, page]);

  const showDeals = (on) => {
    setPage(1);
    setDealsOnly(on);
  };

  const getQuantity = (product) => quantities[product.id] ?? 1;

  // No upper limit: more than is in stock (or none at all) can still be
  // quoted. The card says how long the rest usually takes, and an order for
  // it waits until the stock arrives.
  const setQuantity = (product, value) => {
    const clamped = Math.max(Number(value) || 1, 1);
    setQuantities((prev) => ({ ...prev, [product.id]: clamped }));
  };

  // Derived straight from the cart's own contents rather than a local
  // "just clicked" flag with a timeout -- that way "Added" stays showing for
  // as long as the item is actually in the quote (surviving a page revisit,
  // since the cart persists to localStorage), and automatically reverts to
  // "Add to quote" if it's later removed from the cart page, instead of only
  // ever flashing for ~1s regardless of what's really in there.
  const isInCart = (productId) => items.some((i) => i.product_id === productId);

  const handleAdd = (product) => {
    addItem(product, getQuantity(product));
    setQuantities((prev) => ({ ...prev, [product.id]: 1 }));
  };

  const totalPages = Math.max(Math.ceil(total / limit), 1);

  const emptyDescription = () => {
    if (dealsOnly && !search && !category) return 'No products are on discount right now.';
    if (!search && !category && !dealsOnly) return 'The catalog is empty right now.';
    const where = [category && `the ${category} category`, dealsOnly && 'the products on discount']
      .filter(Boolean)
      .join(' among ');
    return `Nothing matches ${[search && `"${search}"`, where].filter(Boolean).join(' in ')}.`;
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">Products</h1>
          <p className="mt-1 text-sm text-slate-500">Browse the catalog and add items to your quote.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={category}
            onChange={(e) => {
              setPage(1);
              setCategory(e.target.value);
            }}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-teal-500"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
            placeholder="Search by name or SKU"
            className="w-64 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-teal-500"
          />
          {dealCount > 0 && (
            <button
              type="button"
              onClick={() => showDeals(!dealsOnly)}
              aria-pressed={dealsOnly}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                dealsOnly
                  ? 'border-good-500 bg-good-500 text-white'
                  : 'border-good-500 bg-white text-good-500 hover:bg-good-50'
              }`}
            >
              🏷 Deals only
            </button>
          )}
        </div>
      </div>

      {dealCount > 0 && !dealsOnly && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-good-500/30 bg-good-50 px-4 py-3">
          <p className="text-sm text-good-500">
            <span className="font-semibold">
              🏷 {dealCount} product{dealCount === 1 ? ' is' : 's are'} on discount
            </span>{' '}
            right now.
          </p>
          <Button onClick={() => showDeals(true)}>View deals</Button>
        </div>
      )}

      {dealsOnly && (
        <p className="mt-4 text-sm text-slate-600">
          Showing products on discount{category ? ` in ${category}` : ''}.{' '}
          <button type="button" onClick={() => showDeals(false)} className="font-medium text-teal-600 hover:underline">
            Show all products
          </button>
        </p>
      )}

      {loading ? (
        <Spinner />
      ) : products.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="No products found" description={emptyDescription()} />
        </div>
      ) : (
        <>
          {/* Two across on a phone; from tablets up, as many as fit at
              12rem or more each, which is five on a laptop with the menu open. */}
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(12rem,1fr))]">
            {products.map((product) => {
              const note = availabilityNote(product.stock_quantity, getQuantity(product), product.lead_time_days);
              return (
                <Card key={product.id} hoverable className="flex flex-col overflow-hidden">
                  {/* The whole photo, never cropped (contain); click for full size. */}
                  <button
                    type="button"
                    onClick={() => setViewing(product)}
                    className="relative block aspect-[4/3] w-full cursor-zoom-in border-b border-slate-100 bg-white"
                    aria-label={`View photo of ${product.name}`}
                    title="Click to view"
                  >
                    {product.image_url ? (
                      <img src={product.image_url} alt={product.name} className="h-full w-full object-contain p-1.5" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center bg-slate-50 text-slate-300">
                        <PlaceholderIcon className="h-7 w-7" />
                      </span>
                    )}
                    <span
                      className={`absolute left-2 top-2 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        product.stock_quantity > 0 ? 'bg-good-50 text-good-500' : 'bg-bad-50 text-bad-500'
                      }`}
                    >
                      {product.stock_quantity > 0 ? 'In stock' : 'Out of stock'}
                    </span>
                  </button>

                  <div className="flex flex-1 flex-col px-2.5 pb-2.5 pt-2">
                    <p className="line-clamp-2 text-xs font-medium leading-snug text-ink" title={product.name}>
                      {product.name}
                    </p>
                    <p className="mt-0.5 truncate text-[10px] text-slate-400" title={`${product.sku} · ${product.category}`}>
                      <span className="font-mono">{product.sku}</span>
                      {product.category && <span className="capitalize"> · {product.category}</span>}
                    </p>

                    {product.discount && (
                      <p className="mt-1 rounded bg-good-50 px-1.5 py-0.5 text-[10px] leading-snug text-good-500">
                        <span className="font-semibold">{discountLabel(product.discount.percent)}</span>
                        {product.discount.reason && <span>: {product.discount.reason}</span>}
                        {product.discount.ends_on && (
                          <span className="text-slate-500"> · until {formatDay(product.discount.ends_on)}</span>
                        )}
                      </p>
                    )}

                    {note && <p className="mt-1 text-[10px] leading-snug text-amber-600">{note}</p>}

                    <div className="mt-auto pt-1.5">
                      <div className="flex flex-wrap items-baseline gap-x-1.5 border-t border-slate-100 pt-1.5">
                        {product.discount ? (
                          <>
                            <span className="font-mono text-sm font-semibold text-good-500">
                              {formatCurrency(product.discount.price)}
                            </span>
                            <span className="font-mono text-[10px] text-slate-400 line-through">
                              {formatCurrency(product.unit_price)}
                            </span>
                          </>
                        ) : (
                          <span className="font-mono text-sm font-semibold text-ink">{formatCurrency(product.unit_price)}</span>
                        )}
                        <span className="text-[10px] text-slate-400">
                          {product.vat_applicable === false ? 'No VAT' : 'excl. VAT'}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <input
                          type="number"
                          min={1}
                          value={getQuantity(product)}
                          onChange={(e) => setQuantity(product, e.target.value)}
                          aria-label={`Quantity of ${product.name}`}
                          className="w-10 shrink-0 rounded-md border border-slate-200 px-1 py-1 text-xs outline-none transition-colors duration-150 focus:border-teal-500"
                        />
                        <button
                          type="button"
                          onClick={() => handleAdd(product)}
                          className={`min-w-0 flex-1 truncate whitespace-nowrap rounded-md px-1.5 py-1.5 text-xs font-medium transition-colors duration-150 active:scale-[0.98] ${
                            isInCart(product.id)
                              ? 'border border-slate-200 bg-white text-ink hover:bg-slate-50'
                              : 'bg-teal-500 text-white hover:bg-teal-600'
                          }`}
                        >
                          {isInCart(product.id) ? 'Added ✓' : 'Add to quote'}
                        </button>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          <Pagination page={page} totalPages={totalPages} onChange={setPage} />
        </>
      )}

      <ProductImageViewer product={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}

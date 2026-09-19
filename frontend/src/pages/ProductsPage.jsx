import { useEffect, useState } from 'react';
import { getProducts } from '../api/products';
import useCategories from '../hooks/useCategories';
import { useCart } from '../context/CartContext';
import { formatCurrency } from '../utils/formatters';
import Button from '../components/ui/Button';
import Spinner from '../components/ui/Spinner';
import EmptyState from '../components/ui/EmptyState';
import Card from '../components/ui/Card';

export default function ProductsPage() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;
  const { categories } = useCategories();
  const { addItem, items } = useCart();
  const [quantities, setQuantities] = useState({});

  useEffect(() => {
    const timeout = setTimeout(() => {
      setLoading(true);
      getProducts({ search, category: category || undefined, page, limit })
        .then(({ data }) => {
          setProducts(data.data);
          setTotal(data.total);
        })
        .finally(() => setLoading(false));
    }, 300); // debounce search input

    return () => clearTimeout(timeout);
  }, [search, category, page]);

  const getQuantity = (product) => quantities[product.id] ?? 1;

  const setQuantity = (product, value) => {
    const max = product.stock_quantity > 0 ? product.stock_quantity : 1;
    const clamped = Math.min(Math.max(Number(value) || 1, 1), max);
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

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">Products</h1>
          <p className="mt-1 text-sm text-slate-500">Browse the catalog and add items to your quote.</p>
        </div>
        <div className="flex items-center gap-3">
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
        </div>
      </div>

      {loading ? (
        <Spinner />
      ) : products.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No products found"
            description={
              search || category
                ? `Nothing matches ${[search && `"${search}"`, category && `the ${category} category`]
                    .filter(Boolean)
                    .join(' in ')}.`
                : 'The catalog is empty right now.'
            }
          />
        </div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((product) => (
              <Card key={product.id} hoverable className="flex flex-col overflow-hidden">
                {product.image_url ? (
                  <img
                    src={product.image_url}
                    alt={product.name}
                    className="h-40 w-full border-b border-slate-100 object-cover"
                  />
                ) : (
                  <div className="flex h-40 w-full items-center justify-center border-b border-slate-100 bg-slate-50 text-slate-300">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-10 w-10">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="M21 15l-5-5L5 21" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                )}

                <div className="flex flex-1 flex-col p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-ink">{product.name}</p>
                      <p className="mt-0.5 font-mono text-xs text-slate-400">{product.sku}</p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        product.stock_quantity > 0 ? 'bg-good-50 text-good-500' : 'bg-bad-50 text-bad-500'
                      }`}
                    >
                      {product.stock_quantity > 0 ? 'In stock' : 'Out of stock'}
                    </span>
                  </div>

                  <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                    <span className="capitalize">{product.category}</span>
                    <span>{product.lead_time_days}d lead time</span>
                  </div>

                  <div className="mt-4 flex items-end justify-between border-t border-slate-100 pt-3">
                    <div>
                      <p className="font-mono text-lg font-semibold text-ink">{formatCurrency(product.unit_price)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={product.stock_quantity > 0 ? product.stock_quantity : 1}
                        value={getQuantity(product)}
                        onChange={(e) => setQuantity(product, e.target.value)}
                        disabled={product.stock_quantity === 0}
                        className="w-16 rounded-lg border border-slate-200 px-2 py-2 text-sm outline-none transition-colors duration-150 focus:border-teal-500 disabled:bg-slate-50"
                      />
                      <Button
                        variant={isInCart(product.id) ? 'secondary' : 'primary'}
                        onClick={() => handleAdd(product)}
                        disabled={product.stock_quantity === 0}
                      >
                        {isInCart(product.id) ? 'Added ✓' : 'Add to quote'}
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-3">
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <span className="text-sm text-slate-500">
                Page {page} of {totalPages}
              </span>
              <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

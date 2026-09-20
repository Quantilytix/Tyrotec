import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { getAllCustomersAdmin, createCustomerAdmin } from '../../api/customers';
import { getProducts } from '../../api/products';
import { createQuoteForCustomerAdmin } from '../../api/quotes';
import { formatCurrency } from '../../utils/formatters';
import { documentTotals, lineTotals, rateForProduct, vatRateLabel } from '../../utils/vat';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import TotalsSummary from '../../components/ui/TotalsSummary';

const SEARCH_INPUT_CLASS =
  'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-teal-500';

// Deliberately not the global CartContext -- that's the logged-in staff
// member's own personal cart. Reusing it here would cross-wire whatever
// they're building for a customer with their own in-browser cart.
export default function AdminNewQuotePage() {
  const navigate = useNavigate();

  const [customerQuery, setCustomerQuery] = useState('');
  const [customerResults, setCustomerResults] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ email: '', company_name: '', full_name: '', phone: '' });
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [customerError, setCustomerError] = useState('');

  const [productQuery, setProductQuery] = useState('');
  const [productResults, setProductResults] = useState([]);

  const [allCustomers, setAllCustomers] = useState([]);
  const [allProducts, setAllProducts] = useState([]);

  const [items, setItems] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (selectedCustomer || !customerQuery.trim()) {
      setCustomerResults([]);
      return;
    }
    const timeout = setTimeout(() => {
      getAllCustomersAdmin({ search: customerQuery, limit: 8 }).then(({ data }) => setCustomerResults(data.data));
    }, 300);
    return () => clearTimeout(timeout);
  }, [customerQuery, selectedCustomer]);

  useEffect(() => {
    if (!productQuery.trim()) {
      setProductResults([]);
      return;
    }
    const timeout = setTimeout(() => {
      getProducts({ search: productQuery, limit: 8 }).then(({ data }) => setProductResults(data.data));
    }, 300);
    return () => clearTimeout(timeout);
  }, [productQuery]);

  // Full lists for the "pick from all" dropdowns, loaded once -- separate
  // from the debounced-search results above, which only ever hold a
  // handful of matches at a time.
  useEffect(() => {
    getAllCustomersAdmin({ limit: 100 }).then(({ data }) => setAllCustomers(data.data));
    getProducts({ limit: 100 }).then(({ data }) => setAllProducts(data.data));
  }, []);

  const handleCreateCustomer = async () => {
    setCustomerError('');
    if (!newCustomer.email.trim()) {
      setCustomerError('Email is required.');
      return;
    }
    setCreatingCustomer(true);
    try {
      const { data } = await createCustomerAdmin({
        email: newCustomer.email.trim(),
        company_name: newCustomer.company_name.trim() || null,
        full_name: newCustomer.full_name.trim() || null,
        phone: newCustomer.phone.trim() || null,
      });
      setSelectedCustomer(data);
      setShowNewCustomerForm(false);
      setNewCustomer({ email: '', company_name: '', full_name: '', phone: '' });
    } catch (err) {
      setCustomerError(err.response?.data?.error || 'Could not create this customer.');
    } finally {
      setCreatingCustomer(false);
    }
  };

  const addItem = (product) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.product_id === product.id);
      if (existing) {
        return prev.map((i) => (i.product_id === product.id ? { ...i, quantity: i.quantity + 1 } : i));
      }
      return [
        ...prev,
        {
          product_id: product.id,
          name: product.name,
          sku: product.sku,
          unit_price: product.unit_price,
          vat_rate: rateForProduct(product),
          quantity: 1,
        },
      ];
    });
    setProductQuery('');
    setProductResults([]);
  };

  const updateQuantity = (productId, quantity) => {
    setItems((prev) => prev.map((i) => (i.product_id === productId ? { ...i, quantity } : i)));
  };

  const removeItem = (productId) => setItems((prev) => prev.filter((i) => i.product_id !== productId));

  // Preview only -- the server prices the quote again from the product
  // records when it is created.
  const totals = documentTotals(items);

  const handleSubmit = async () => {
    setError('');
    setSubmitting(true);
    try {
      const payload = items.map((i) => ({ product_id: i.product_id, quantity: i.quantity }));
      const { data } = await createQuoteForCustomerAdmin(selectedCustomer.id, payload);
      navigate(`/admin/quotes/${data.quoteId}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create this quote. Try again.');
      setSubmitting(false);
    }
  };

  return (
    <div>
      <Link to="/admin/quotes" className="text-sm text-teal-600 hover:underline">
        ← Back to quotes
      </Link>

      <h1 className="mt-3 font-display text-xl font-semibold text-ink">New quote for a customer</h1>
      <p className="mt-1 text-sm text-slate-500">Pick a customer and add products. The quote is created in their name.</p>

      <Card className="mt-6 p-5">
        <h2 className="font-display text-base font-semibold text-ink">Customer</h2>
        {selectedCustomer ? (
          <div className="mt-3 flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
            <div>
              <p className="text-sm font-medium text-ink">{selectedCustomer.company_name || selectedCustomer.email}</p>
              {selectedCustomer.company_name && <p className="text-xs text-slate-400">{selectedCustomer.email}</p>}
            </div>
            <button
              onClick={() => {
                setSelectedCustomer(null);
                setCustomerQuery('');
              }}
              className="text-xs font-medium text-teal-600 transition-colors duration-150 hover:underline"
            >
              Change
            </button>
          </div>
        ) : showNewCustomerForm ? (
          <div className="mt-3 space-y-2">
            <input
              type="email"
              value={newCustomer.email}
              onChange={(e) => setNewCustomer((prev) => ({ ...prev, email: e.target.value }))}
              placeholder="Email (required)"
              className={SEARCH_INPUT_CLASS}
            />
            <input
              type="text"
              value={newCustomer.full_name}
              onChange={(e) => setNewCustomer((prev) => ({ ...prev, full_name: e.target.value }))}
              placeholder="Full name"
              className={SEARCH_INPUT_CLASS}
            />
            <input
              type="text"
              value={newCustomer.company_name}
              onChange={(e) => setNewCustomer((prev) => ({ ...prev, company_name: e.target.value }))}
              placeholder="Company name"
              className={SEARCH_INPUT_CLASS}
            />
            <input
              type="text"
              value={newCustomer.phone}
              onChange={(e) => setNewCustomer((prev) => ({ ...prev, phone: e.target.value }))}
              placeholder="Phone (optional)"
              className={SEARCH_INPUT_CLASS}
            />
            {customerError && <p className="text-sm text-bad-500">{customerError}</p>}
            <div className="flex items-center gap-3">
              <Button onClick={handleCreateCustomer} loading={creatingCustomer}>
                Create customer
              </Button>
              <button
                onClick={() => {
                  setShowNewCustomerForm(false);
                  setCustomerError('');
                }}
                className="text-xs font-medium text-slate-500 transition-colors duration-150 hover:underline"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3">
            <select
              value=""
              onChange={(e) => {
                const customer = allCustomers.find((c) => c.id === e.target.value);
                if (customer) setSelectedCustomer(customer);
              }}
              className={SEARCH_INPUT_CLASS}
            >
              <option value="">Choose a registered customer...</option>
              {allCustomers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company_name || c.email}
                  {c.company_name ? ` (${c.email})` : ''}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-slate-400">or search instead</p>
            <input
              type="text"
              value={customerQuery}
              onChange={(e) => setCustomerQuery(e.target.value)}
              placeholder="Search by email or company name"
              className={`${SEARCH_INPUT_CLASS} mt-1`}
            />
            {customerResults.length > 0 && (
              <div className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
                {customerResults.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setSelectedCustomer(c);
                      setCustomerResults([]);
                    }}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-slate-50"
                  >
                    <span className="text-ink">{c.company_name || c.email}</span>
                    {c.company_name && <span className="text-xs text-slate-400">{c.email}</span>}
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={() => setShowNewCustomerForm(true)}
              className="mt-2 text-xs font-medium text-teal-600 transition-colors duration-150 hover:underline"
            >
              + New customer (no account yet)
            </button>
          </div>
        )}
      </Card>

      <Card className="mt-6 p-5">
        <h2 className="font-display text-base font-semibold text-ink">Products</h2>
        <div className="mt-3">
          <select
            value=""
            onChange={(e) => {
              const product = allProducts.find((p) => p.id === e.target.value);
              if (product) addItem(product);
            }}
            className={SEARCH_INPUT_CLASS}
          >
            <option value="">Choose a product...</option>
            {allProducts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.sku}) · {formatCurrency(p.unit_price)} excl. VAT
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-slate-400">or search instead</p>
          <input
            type="text"
            value={productQuery}
            onChange={(e) => setProductQuery(e.target.value)}
            placeholder="Search by name or SKU"
            className={`${SEARCH_INPUT_CLASS} mt-1`}
          />
          {productResults.length > 0 && (
            <div className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {productResults.map((p) => (
                <button
                  key={p.id}
                  onClick={() => addItem(p)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-slate-50"
                >
                  <span>
                    <span className="text-ink">{p.name}</span>{' '}
                    <span className="font-mono text-xs text-slate-400">{p.sku}</span>
                  </span>
                  <span className="font-mono text-xs text-ink">{formatCurrency(p.unit_price)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {items.length > 0 && (
          <table className="mt-4 w-full text-sm">
            <thead className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2">Product</th>
                <th className="py-2">Unit price (excl. VAT)</th>
                <th className="py-2">Quantity</th>
                <th className="py-2">VAT</th>
                <th className="py-2">Line total (excl. VAT)</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => (
                <tr key={item.product_id}>
                  <td className="py-2">
                    <p className="font-medium text-ink">{item.name}</p>
                    <p className="font-mono text-xs text-slate-400">{item.sku}</p>
                  </td>
                  <td className="py-2 font-mono text-ink">{formatCurrency(item.unit_price)}</td>
                  <td className="py-2">
                    <input
                      type="number"
                      min={1}
                      value={item.quantity}
                      onChange={(e) => updateQuantity(item.product_id, Math.max(Number(e.target.value), 1))}
                      className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-sm outline-none transition-colors duration-150 focus:border-teal-500"
                    />
                  </td>
                  <td className="py-2 text-slate-600">{vatRateLabel(item.vat_rate)}</td>
                  <td className="py-2 font-mono font-medium text-ink">
                    {formatCurrency(lineTotals(item).net)}
                  </td>
                  <td className="py-2 text-right">
                    <button
                      onClick={() => removeItem(item.product_id)}
                      className="text-xs font-medium text-bad-500 transition-colors duration-150 hover:underline"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="mt-6 flex items-center justify-between p-4">
        <TotalsSummary totals={totals} className="text-left" />
        <div className="flex items-center gap-3">
          {error && <p className="text-sm text-bad-500">{error}</p>}
          <Button
            onClick={handleSubmit}
            loading={submitting}
            disabled={!selectedCustomer || items.length === 0}
          >
            Create quote
          </Button>
        </div>
      </Card>
    </div>
  );
}

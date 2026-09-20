import { createContext, useContext, useEffect, useState } from 'react';
import { documentTotals, rateForProduct, VAT_RATE } from '../utils/vat';

const CartContext = createContext(null);
const STORAGE_KEY = 'jamlea_cart_items';

// Read once at mount, not on every render -- a plain function passed to
// useState's lazy-initializer form. Wrapped in try/catch since localStorage
// can throw (private browsing, storage disabled) and a corrupted/foreign
// value stored under this key shouldn't crash the app, just start empty.
function loadStoredItems() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    // A cart saved before VAT-exclusive pricing has no rate on its lines.
    // Default those to the standard rate rather than showing the customer a
    // VAT-free total the server won't honour; the server prices it properly
    // on submit either way.
    return parsed.map((item) => ({ ...item, vat_rate: item.vat_rate ?? VAT_RATE }));
  } catch {
    return [];
  }
}

// The "cart" is a draft quote -- an array of
// { product_id, name, sku, unit_price, quantity }. It only becomes a real
// quote once the customer submits it via POST /quotes. Persisted to
// localStorage (this browser only, never sent anywhere) so a refresh, a
// closed tab, or a session timeout doesn't silently wipe an in-progress
// quote the customer was still building.
export function CartProvider({ children }) {
  const [items, setItems] = useState(loadStoredItems);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Storage full/disabled -- the cart still works for this session,
      // it just won't survive a refresh. Not worth surfacing to the user.
    }
  }, [items]);

  const addItem = (product, quantity = 1) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.product_id === product.id);
      if (existing) {
        return prev.map((i) =>
          i.product_id === product.id ? { ...i, quantity: i.quantity + quantity } : i
        );
      }
      return [
        ...prev,
        {
          product_id: product.id,
          name: product.name,
          sku: product.sku,
          // Excl VAT, with the rate this product carries. Both are only for
          // showing the customer what they're building: the server prices the
          // quote again from the product record when it's submitted.
          unit_price: product.unit_price,
          vat_rate: rateForProduct(product),
          quantity,
        },
      ];
    });
  };

  const updateQuantity = (productId, quantity) => {
    setItems((prev) =>
      prev.map((i) => (i.product_id === productId ? { ...i, quantity } : i))
    );
  };

  const removeItem = (productId) => {
    setItems((prev) => prev.filter((i) => i.product_id !== productId));
  };

  const clearCart = () => setItems([]);

  // Prices are excl VAT, so the cart shows the same three figures a quote
  // does. totalAmount stays the VAT-inclusive grand total, which is what the
  // customer actually pays.
  const totals = documentTotals(items);
  const totalAmount = totals.total_amount;
  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <CartContext.Provider
      value={{ items, addItem, updateQuantity, removeItem, clearCart, totals, totalAmount, totalItems }}
    >
      {children}
    </CartContext.Provider>
  );
}

export const useCart = () => useContext(CartContext);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// "View in Tyrotec" on a record in QX signs the person in and names the record
// to open: QX's name for its type, and this portal's id for it. Unknown types
// and malformed ids open the closest list, or the home page.
export function recordPage(entity, ref) {
  const id = UUID.test(ref || '') ? ref : null;
  switch (entity) {
    case 'order': return id ? `/admin/orders/${id}` : '/admin/orders';
    case 'quote': return id ? `/admin/quotes/${id}` : '/admin/quotes';
    case 'customer': return id ? `/admin/customers/${id}` : '/admin/customers';
    case 'purchase': return id ? `/admin/purchases/${id}` : '/admin/purchases';
    case 'product': return '/admin/products';
    case 'supplier': return '/admin/suppliers';
    default: return '/';
  }
}

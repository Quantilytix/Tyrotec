import apiClient from './client';

export const getCustomerOrders = () => apiClient.get('/orders/my-orders');

export const getOrderById = (id) => apiClient.get(`/orders/${id}`);

// kind: 'orders' (placed by customers on the portal or WhatsApp) or
// 'invoices' (staff-made sales, with an INV- number). Omitted: both.
export const getAllOrdersAdmin = (kind) => apiClient.get('/orders/admin/all', { params: { kind } });

// The tax invoice PDF of a staff-made sale (staff, or the invoice's customer).
export const downloadInvoicePdf = (orderId) =>
  apiClient.get(`/orders/${orderId}/invoice-pdf`, { responseType: 'blob' });

// Staff: email the tax invoice PDF to the customer.
export const emailInvoice = (orderId) => apiClient.post(`/orders/${orderId}/email-invoice`);

export const updateOrderStatus = (id, status) =>
  apiClient.patch(`/orders/${id}/status`, { status });

// Customer: pay online with Paystack. Returns { url } -- Paystack's payment
// page to send the browser to. No Paystack key is ever in the portal; the API
// holds it.
export const startOnlinePayment = (orderId) => apiClient.post(`/orders/${orderId}/pay`);

// Customer, back from Paystack (?reference=... on the order page): the API
// asks Paystack what happened. Returns { outcome }: 'paid', 'needs_review',
// 'not_paid' or 'unknown'.
export const confirmOnlinePayment = (orderId, reference) =>
  apiClient.post(`/orders/${orderId}/pay/confirm`, { reference });

// Staff: tell the customer of an order waiting for stock when it should
// arrive, as a number of days from today.
export const setOrderStockEta = (orderId, days) => apiClient.patch(`/orders/${orderId}/stock-eta`, { days });

// Staff: the stock an order was waiting for has arrived. Records the supplier's
// delivery as a purchase and approves the order with it.
// delivery: { supplier_id, supplier_invoice_number, lines: [{ product_id, quantity, unit_cost }] }
export const receiveStockForOrder = (orderId, delivery) => apiClient.post(`/orders/${orderId}/receive-stock`, delivery);

// Lean, poll-friendly status lookup for OrderStatusPanel.jsx.
export const getOrderStatus = (orderId) => apiClient.get(`/orders/${orderId}/status`);

// Be invoiced for this order instead of paying online. Only offered to
// accounts a staff member has approved for it; drops the reservation timer.
export const payOrderOnInvoice = (orderId) => apiClient.post(`/orders/${orderId}/pay-on-invoice`);

// Excel export: one sheet of orders (including payment details), one of their
// line items. kind ('orders'/'invoices'), source and search as on screen, plus
// a created-at date range (YYYY-MM-DD). The table's status filter is a group
// of stored statuses, which the export doesn't take, so it isn't sent.
export const exportOrdersAdmin = ({ kind, source, search, from, to } = {}) =>
  apiClient.get('/orders/admin/export', { params: { kind, source, search, from, to }, responseType: 'blob' });

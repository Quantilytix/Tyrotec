import apiClient from './client';

export const getCustomerOrders = () => apiClient.get('/orders/my-orders');

export const getOrderById = (id) => apiClient.get(`/orders/${id}`);

export const getAllOrdersAdmin = () => apiClient.get('/orders/admin/all');

export const updateOrderStatus = (id, status) =>
  apiClient.patch(`/orders/${id}/status`, { status });

// order must be 'stock_reserved'. Returns { action, fields } -- the
// PayFast checkout URL and the signed form fields to auto-post the browser
// to (see PayfastRedirectForm.jsx).
export const initiatePayfastPayment = (orderId) => apiClient.post(`/orders/${orderId}/pay`);

// Lean, poll-friendly status lookup for OrderStatusPanel.jsx.
export const getOrderStatus = (orderId) => apiClient.get(`/orders/${orderId}/status`);

// The manual bank-transfer fallback for a stock_reserved (or, same as
// today, approved) order -- always routes to the admin review queue,
// never auto-confirms.
export const submitManualPaymentForReview = (orderId, payload) =>
  apiClient.post(`/orders/${orderId}/manual-payment`, payload);

// Excel export: one sheet of orders (including payment details), one of their
// line items. Optional source and created-at date range (YYYY-MM-DD).
export const exportOrdersAdmin = ({ source, from, to } = {}) =>
  apiClient.get('/orders/admin/export', { params: { source, from, to }, responseType: 'blob' });

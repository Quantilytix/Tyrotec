import apiClient from './client';

// Staff only -- records money already verified in the bank and marks the
// order paid in one step. Customers have no equivalent; they pay via Paystack
// (see startOnlinePayment in api/orders.js).
export const recordPayment = (payment) => apiClient.post('/payments', payment);

// archived: true lists only the archived payments instead.
export const getAllPaymentsAdmin = ({ archived = false } = {}) =>
  apiClient.get('/payments/admin/all', { params: archived ? { archived: true } : {} });

export const updatePaymentStatus = (id, status) =>
  apiClient.patch(`/payments/${id}/status`, { status });

// Admin only. Cancelled or rejected payments; archived: false restores one.
export const setPaymentArchived = (id, archived) =>
  apiClient.patch(`/payments/${id}/archive`, { archived });

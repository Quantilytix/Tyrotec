import apiClient from './client';

// Staff only -- records money already verified in the bank and marks the
// order paid in one step. Customers have no equivalent; they pay via PayFast
// (see initiatePayfastPayment in api/orders.js).
export const recordPayment = (payment) => apiClient.post('/payments', payment);

export const getAllPaymentsAdmin = () => apiClient.get('/payments/admin/all');

export const updatePaymentStatus = (id, status) =>
  apiClient.patch(`/payments/${id}/status`, { status });

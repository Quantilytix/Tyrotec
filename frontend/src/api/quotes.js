import apiClient from './client';

export const createQuote = (items) => apiClient.post('/quotes', { items });

export const createQuoteForCustomerAdmin = (customerId, items) =>
  apiClient.post('/quotes/admin/for-customer', { customer_id: customerId, items });

export const getCustomerQuotes = () => apiClient.get('/quotes/my-quotes');

export const getQuoteById = (quoteId) => apiClient.get(`/quotes/${quoteId}`);

export const convertQuoteToOrder = (quoteId) =>
  apiClient.post(`/quotes/${quoteId}/convert`);

// The fast, automated path -- stock is checked/reserved immediately instead
// of waiting on admin approval. Payment (PayFast or bank transfer) is always
// a separate step taken afterwards from the order page, never triggered here.
// Returns { status: 'stock_reserved' } on success or
// { status: 'pending_approval', shortProductId, ... } if stock was short.
export const checkoutQuoteFast = (quoteId) =>
  apiClient.post(`/quotes/${quoteId}/checkout`);

export const getAllQuotesAdmin = () => apiClient.get('/quotes/admin/all');

export const updateQuoteStatus = (quoteId, status) =>
  apiClient.patch(`/quotes/${quoteId}/status`, { status });

// Excel export: one sheet of quotes, one of their line items. Optional source
// and created-at date range (YYYY-MM-DD), matching the admin screen's filters.
export const exportQuotesAdmin = ({ source, from, to } = {}) =>
  apiClient.get('/quotes/admin/export', { params: { source, from, to }, responseType: 'blob' });

import apiClient from './client';

export const getPurchases = ({ supplierId, search, page = 1, limit = 20 } = {}) =>
  apiClient.get('/purchases', { params: { supplier_id: supplierId, search, page, limit } });

export const getPurchase = (id) => apiClient.get(`/purchases/${id}`);

// Records goods received: stock and average costs update immediately.
// Purchases can't be edited afterwards.
export const createPurchase = (purchase) => apiClient.post('/purchases', purchase);

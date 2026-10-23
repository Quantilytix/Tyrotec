import apiClient from './client';

// Admins only (backend/src/routes/discountRoutes.js).
export const getDiscounts = () => apiClient.get('/discounts');

// { reason, percent, ends_on (YYYY-MM-DD or null), product_ids }
export const createDiscount = (discount) => apiClient.post('/discounts', discount);

export const endDiscount = (id) => apiClient.post(`/discounts/${id}/end`);

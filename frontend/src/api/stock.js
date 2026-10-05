import apiClient from './client';

export const getStockAdjustments = ({ productId, page = 1, limit = 20 } = {}) =>
  apiClient.get('/stock/adjustments', { params: { product_id: productId, page, limit } });

// Admin only.
export const createStockAdjustment = (adjustment) => apiClient.post('/stock/adjustments', adjustment);

// Admin only. Recorded once, at go-live.
export const getOpeningStock = () => apiClient.get('/stock/opening');

export const recordOpeningStock = ({ asOfDate, costs }) =>
  apiClient.post('/stock/opening', { as_of_date: asOfDate, costs });

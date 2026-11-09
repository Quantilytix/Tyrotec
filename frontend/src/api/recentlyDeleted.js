import apiClient from './client';

// Admin only. Recently deleted: what was deleted in the last 30 days.
export const getRecentlyDeleted = () => apiClient.get('/recently-deleted');

// type: 'quote' | 'order' (orders and invoices) | 'purchase' | 'customer'.
export const deleteRecord = (type, id) => apiClient.post(`/recently-deleted/${type}/${id}`);

export const restoreRecord = (type, id) => apiClient.post(`/recently-deleted/${type}/${id}/restore`);

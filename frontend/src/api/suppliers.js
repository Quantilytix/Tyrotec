import apiClient from './client';

// Staff only. Inactive suppliers are left out unless includeInactive is set.
export const getSuppliers = ({ search, includeInactive = false } = {}) =>
  apiClient.get('/suppliers', { params: { search, include_inactive: includeInactive ? 'true' : undefined } });

export const createSupplier = (supplier) => apiClient.post('/suppliers', supplier);

export const updateSupplier = (id, supplier) => apiClient.patch(`/suppliers/${id}`, supplier);

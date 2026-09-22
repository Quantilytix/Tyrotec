import apiClient from './client';

export const getAllCustomersAdmin = ({ search, page = 1, limit = 20 } = {}) =>
  apiClient.get('/customers/admin/all', { params: { search, page, limit } });

export const getCustomerDetailAdmin = (id) => apiClient.get(`/customers/admin/${id}`);

export const createCustomerAdmin = (customer) => apiClient.post('/customers/admin', customer);

// Credit decision: lets this customer place orders payable on invoice rather
// than paying up front. Staff only, and written to the audit log.
export const setCustomerAccountTerms = (id, canOrderOnAccount) =>
  apiClient.patch(`/customers/admin/${id}/account-terms`, { can_order_on_account: canOrderOnAccount });

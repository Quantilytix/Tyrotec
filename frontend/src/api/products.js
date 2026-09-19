import apiClient from './client';

export const getProducts = ({ search, category, page = 1, limit = 20 } = {}) =>
  apiClient.get('/products', { params: { search, category, page, limit } });

export const getProductById = (id) => apiClient.get(`/products/${id}`);

// The managed category list (backend/sql/022_product_categories.sql). Every
// signed-in user can read it -- customers use it for the catalogue filter --
// but only staff can change it.
export const getCategories = () => apiClient.get('/products/categories');

export const createCategory = (name) => apiClient.post('/products/categories', { name });

export const deleteCategory = (id) => apiClient.delete(`/products/categories/${id}`);

export const createProduct = (product) => apiClient.post('/products', product);

export const updateProduct = (id, product) => apiClient.patch(`/products/${id}`, product);

export const deleteProduct = (id) => apiClient.delete(`/products/${id}`);

// Don't set a Content-Type header here -- axios/the browser needs to generate
// its own multipart boundary from the FormData object, which only happens
// when Content-Type is left unset. Setting 'multipart/form-data' manually
// (no boundary) produces a body the server can't parse.
export const uploadProductImage = (file) => {
  const formData = new FormData();
  formData.append('image', file);
  return apiClient.post('/products/upload-image', formData);
};

// Same unset-Content-Type reasoning as uploadProductImage above.
export const extractProductImport = (file) => {
  const formData = new FormData();
  formData.append('file', file);
  return apiClient.post('/products/import/extract', formData);
};

export const confirmProductImport = (rows) => apiClient.post('/products/import/confirm', { rows });

// Excel export of the catalogue, honouring the same search/category filters
// as the product list. Returns a blob -- see utils/downloadFile.js.
export const exportProducts = ({ search, category } = {}) =>
  apiClient.get('/products/export', { params: { search, category }, responseType: 'blob' });

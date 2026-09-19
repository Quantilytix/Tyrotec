import { useEffect, useState } from 'react';
import { getProducts, createProduct, updateProduct, deleteProduct, exportProducts } from '../../api/products';
import { formatCurrency } from '../../utils/formatters';
import { saveBlobResponse, blobErrorMessage } from '../../utils/downloadFile';
import Button from '../../components/ui/Button';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import Modal from '../../components/ui/Modal';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Card from '../../components/ui/Card';
import ProductForm from '../../components/admin/ProductForm';
import ProductImportModal from '../../components/admin/ProductImportModal';
import CategoryManager from '../../components/admin/CategoryManager';
import useCategories from '../../hooks/useCategories';

export default function AdminProductsPage() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;
  const { categories, addCategory, removeCategory } = useCategories();

  const [modalMode, setModalMode] = useState(null); // null | 'create' | 'edit' | 'import' | 'supplier' | 'categories'
  const [editingProduct, setEditingProduct] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const [confirmingDelete, setConfirmingDelete] = useState(null); // product | null

  const load = () => {
    setLoading(true);
    return getProducts({ search, category: category || undefined, page, limit })
      .then(({ data }) => {
        setProducts(data.data);
        setTotal(data.total);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const timeout = setTimeout(load, 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, category, page]);

  const totalPages = Math.max(Math.ceil(total / limit), 1);

  const openCreate = () => {
    setEditingProduct(null);
    setModalMode('create');
  };
  const openEdit = (product) => {
    setEditingProduct(product);
    setModalMode('edit');
  };
  const openSupplier = (product) => {
    setEditingProduct(product);
    setModalMode('supplier');
  };
  const openImport = () => setModalMode('import');
  const closeModal = () => setModalMode(null);
  const handleImportDone = () => {
    closeModal();
    load();
  };

  const handleSubmit = async (payload) => {
    if (modalMode === 'edit') {
      await updateProduct(editingProduct.id, payload);
    } else {
      await createProduct(payload);
    }
    closeModal();
    load();
  };

  // Exports every product matching the current search/category, not just the
  // page on screen -- the server applies the same filters.
  const handleExport = async () => {
    setExportError('');
    setExporting(true);
    try {
      const response = await exportProducts({ search, category: category || undefined });
      saveBlobResponse(response, 'products.xlsx');
    } catch (err) {
      setExportError(await blobErrorMessage(err, 'Could not export the products.'));
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async (product) => {
    setDeleteError('');
    setDeletingId(product.id);
    try {
      await deleteProduct(product.id);
      load();
    } catch (err) {
      setDeleteError(err.response?.data?.error || 'Could not delete this product.');
    } finally {
      setDeletingId(null);
      setConfirmingDelete(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">Products</h1>
          <p className="mt-1 text-sm text-slate-500">Manage the catalog customers order from.</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
            placeholder="Search by name or SKU"
            className="w-64 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-teal-500"
          />
          <select
            value={category}
            onChange={(e) => {
              setPage(1);
              setCategory(e.target.value);
            }}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-teal-500"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          <Button variant="secondary" onClick={() => setModalMode('categories')}>Manage categories</Button>
          <Button variant="secondary" onClick={handleExport} loading={exporting}>Export to Excel</Button>
          <Button variant="secondary" onClick={openImport}>Import from file</Button>
          <Button onClick={openCreate}>Add product</Button>
        </div>
      </div>

      {(deleteError || exportError) && (
        <p className="mt-4 rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-500">{deleteError || exportError}</p>
      )}

      {loading ? (
        <Spinner />
      ) : products.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No products found"
            description={search ? `Nothing matches "${search}".` : 'Add your first product to get started.'}
          />
        </div>
      ) : (
        <>
          <Card className="mt-6 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Price</th>
                  <th className="px-4 py-3">Stock</th>
                  <th className="px-4 py-3">Availability</th>
                  <th className="px-4 py-3">Supplier</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {products.map((product) => (
                  <tr key={product.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink">{product.name}</p>
                      <p className="font-mono text-xs text-slate-400">{product.sku}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600 capitalize">{product.category}</td>
                    <td className="px-4 py-3 font-mono text-ink">{formatCurrency(product.unit_price)}</td>
                    <td className="px-4 py-3 text-slate-600">{product.stock_quantity}</td>
                    <td className="px-4 py-3 text-slate-600 capitalize">{product.availability}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {product.supplier_name ? (
                        <button
                          onClick={() => openSupplier(product)}
                          className="font-medium text-teal-600 transition-colors duration-150 hover:underline"
                        >
                          {product.supplier_name}
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => openEdit(product)}
                        className="text-xs font-medium text-teal-600 transition-colors duration-150 hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setConfirmingDelete(product)}
                        disabled={deletingId === product.id}
                        className="ml-3 text-xs font-medium text-bad-500 transition-colors duration-150 hover:underline disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-3">
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <span className="text-sm text-slate-500">
                Page {page} of {totalPages}
              </span>
              <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          )}
        </>
      )}

      {(modalMode === 'create' || modalMode === 'edit') && (
        <Modal title={modalMode === 'edit' ? 'Edit product' : 'Add product'} onClose={closeModal}>
          <ProductForm
            initialProduct={editingProduct}
            onSubmit={handleSubmit}
            onCancel={closeModal}
            categories={categories}
            onCreateCategory={addCategory}
          />
        </Modal>
      )}

      {modalMode === 'import' && (
        <Modal title="Import products from file" onClose={closeModal} wide>
          <ProductImportModal
            onDone={handleImportDone}
            categories={categories}
            onCreateCategory={addCategory}
          />
        </Modal>
      )}

      {modalMode === 'categories' && (
        <Modal title="Manage categories" onClose={closeModal}>
          <CategoryManager categories={categories} onAdd={addCategory} onRemove={removeCategory} />
        </Modal>
      )}

      {modalMode === 'supplier' && editingProduct && (
        <Modal title="Supplier details" onClose={closeModal}>
          <div className="space-y-4">
            <p className="text-sm text-slate-500">For {editingProduct.name}</p>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Name</dt>
                <dd className="mt-0.5 text-ink">{editingProduct.supplier_name || 'Not provided'}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Location</dt>
                <dd className="mt-0.5 text-ink">{editingProduct.supplier_location || 'Not provided'}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Phone</dt>
                <dd className="mt-0.5 text-ink">{editingProduct.supplier_phone || 'Not provided'}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Email</dt>
                <dd className="mt-0.5 text-ink">{editingProduct.supplier_email || 'Not provided'}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Cost price</dt>
                <dd className="mt-0.5 text-ink">
                  {editingProduct.supplier_cost != null ? formatCurrency(editingProduct.supplier_cost) : 'Not provided'}
                </dd>
              </div>
              {editingProduct.supplier_cost != null && (
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Margin</dt>
                  <dd className="mt-0.5 text-ink">
                    {formatCurrency(editingProduct.unit_price - editingProduct.supplier_cost)}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </Modal>
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete this product?"
          message={`"${confirmingDelete.name}" will be permanently removed from the catalog. This can't be undone.`}
          confirmLabel="Delete product"
          onConfirm={() => handleDelete(confirmingDelete)}
          onCancel={() => setConfirmingDelete(null)}
          loading={deletingId === confirmingDelete.id}
        />
      )}
    </div>
  );
}

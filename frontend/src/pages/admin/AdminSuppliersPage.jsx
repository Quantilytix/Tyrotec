import { useEffect, useState } from 'react';
import { getSuppliers, createSupplier, updateSupplier } from '../../api/suppliers';
import Button from '../../components/ui/Button';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import Modal from '../../components/ui/Modal';
import Card from '../../components/ui/Card';

const FIELD_CLASS =
  'mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-teal-500';
const LABEL_CLASS = 'block text-xs font-medium text-slate-600';

const EMPTY = { name: '', email: '', phone: '', location: '', vat_number: '', credit_terms_days: 30 };

function SupplierForm({ initial, onSubmit, onCancel }) {
  const [form, setForm] = useState(() =>
    initial
      ? {
          name: initial.name,
          email: initial.email || '',
          phone: initial.phone || '',
          location: initial.location || '',
          vat_number: initial.vat_number || '',
          credit_terms_days: initial.credit_terms_days,
        }
      : EMPTY
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const update = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await onSubmit({ ...form, credit_terms_days: Number(form.credit_terms_days) });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save this supplier.');
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className={LABEL_CLASS}>Name</label>
        <input required value={form.name} onChange={update('name')} className={FIELD_CLASS} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={LABEL_CLASS}>Email (optional)</label>
          <input type="email" value={form.email} onChange={update('email')} className={FIELD_CLASS} />
        </div>
        <div>
          <label className={LABEL_CLASS}>Phone (optional)</label>
          <input value={form.phone} onChange={update('phone')} className={FIELD_CLASS} />
        </div>
        <div>
          <label className={LABEL_CLASS}>Location (optional)</label>
          <input value={form.location} onChange={update('location')} className={FIELD_CLASS} />
        </div>
        <div>
          <label className={LABEL_CLASS}>VAT number (optional)</label>
          <input value={form.vat_number} onChange={update('vat_number')} className={FIELD_CLASS} />
        </div>
        <div>
          <label className={LABEL_CLASS}>Payment terms (days)</label>
          <input
            required
            type="number"
            min="0"
            max="365"
            value={form.credit_terms_days}
            onChange={update('credit_terms_days')}
            className={FIELD_CLASS}
          />
          <p className="mt-1 text-xs text-slate-400">When their invoices are due, counted from delivery.</p>
        </div>
      </div>

      {error && <p className="rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-500">{error}</p>}

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          {initial ? 'Save changes' : 'Add supplier'}
        </Button>
      </div>
    </form>
  );
}

export default function AdminSuppliersPage() {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState(undefined); // undefined = closed, null = new, supplier = edit
  const [error, setError] = useState('');
  const [togglingId, setTogglingId] = useState(null);

  const load = () =>
    getSuppliers({ search: search || undefined, includeInactive: showInactive })
      .then(({ data }) => setSuppliers(data.data))
      .finally(() => setLoading(false));

  useEffect(() => {
    const timeout = setTimeout(load, 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, showInactive]);

  const handleSubmit = async (payload) => {
    if (editing) await updateSupplier(editing.id, payload);
    else await createSupplier(payload);
    setEditing(undefined);
    load();
  };

  const toggleActive = async (supplier) => {
    setError('');
    setTogglingId(supplier.id);
    try {
      await updateSupplier(supplier.id, { is_active: !supplier.is_active });
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not update this supplier.');
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold text-ink">Suppliers</h1>
          <p className="mt-1 text-sm text-slate-500">Who you buy stock from. Products and purchases are linked to these.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email"
            className="w-64 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-teal-500"
          />
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            />
            Show inactive
          </label>
          <Button onClick={() => setEditing(null)}>Add supplier</Button>
        </div>
      </div>

      {error && <p className="mt-4 rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-500">{error}</p>}

      {loading ? (
        <Spinner />
      ) : suppliers.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No suppliers found"
            description={search ? `Nothing matches "${search}".` : 'Add the suppliers you buy stock from.'}
          />
        </div>
      ) : (
        <Card className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Terms</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {suppliers.map((supplier) => (
                <tr key={supplier.id} className={supplier.is_active ? '' : 'opacity-60'}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink">{supplier.name}</p>
                    {supplier.vat_number && <p className="text-xs text-slate-400">VAT {supplier.vat_number}</p>}
                    {!supplier.is_active && <p className="text-xs text-slate-400">Inactive</p>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    <p>{supplier.email || '—'}</p>
                    {supplier.phone && <p className="text-xs text-slate-400">{supplier.phone}</p>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{supplier.location || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{supplier.credit_terms_days} days</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setEditing(supplier)}
                      className="text-xs font-medium text-teal-600 transition-colors duration-150 hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => toggleActive(supplier)}
                      disabled={togglingId === supplier.id}
                      className="ml-3 text-xs font-medium text-slate-500 transition-colors duration-150 hover:underline disabled:opacity-50"
                    >
                      {supplier.is_active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {editing !== undefined && (
        <Modal title={editing ? 'Edit supplier' : 'Add supplier'} onClose={() => setEditing(undefined)}>
          <SupplierForm initial={editing} onSubmit={handleSubmit} onCancel={() => setEditing(undefined)} />
        </Modal>
      )}
    </div>
  );
}

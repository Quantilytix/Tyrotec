import { useState } from 'react';
import Button from '../ui/Button';

// Add or edit a supplier. Used on the Suppliers page and, for a supplier
// that isn't on the list yet, straight from the purchase form.
const FIELD_CLASS =
  'mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-teal-500';
const LABEL_CLASS = 'block text-xs font-medium text-slate-600';

const EMPTY = { name: '', email: '', phone: '', location: '', vat_number: '', credit_terms_days: 30 };

export default function SupplierForm({ initial, onSubmit, onCancel }) {
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

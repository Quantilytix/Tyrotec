import { useState } from 'react';
import Button from '../ui/Button';
import { createCustomerAdmin } from '../../api/customers';

const FIELD_CLASS =
  'mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-teal-500';
const LABEL_CLASS = 'block text-xs font-medium text-slate-600';

// Staff add a customer on their own, before any quote or invoice. The account
// is real (customerController.createCustomerAdmin): they can sign in to the
// portal later with "Forgot password?" on their email. The VAT number and
// address are printed on their quotes and invoices.
export default function NewCustomerForm({ onCreated, onCancel }) {
  const [form, setForm] = useState({ email: '', company_name: '', full_name: '', phone: '', vat_number: '', address: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const update = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const trimmed = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim() || undefined]));
      const { data } = await createCustomerAdmin(trimmed);
      await onCreated(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add this customer.');
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className={LABEL_CLASS}>Email</label>
        <input required type="email" value={form.email} onChange={update('email')} className={FIELD_CLASS} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={LABEL_CLASS}>Company name</label>
          <input value={form.company_name} onChange={update('company_name')} className={FIELD_CLASS} />
        </div>
        <div>
          <label className={LABEL_CLASS}>Contact person</label>
          <input value={form.full_name} onChange={update('full_name')} className={FIELD_CLASS} />
        </div>
        <div>
          <label className={LABEL_CLASS}>Phone</label>
          <input
            value={form.phone}
            onChange={update('phone')}
            placeholder="Include country code, e.g. 27821234567"
            className={FIELD_CLASS}
          />
        </div>
        <div>
          <label className={LABEL_CLASS}>VAT number (optional)</label>
          <input value={form.vat_number} onChange={update('vat_number')} maxLength={30} className={FIELD_CLASS} />
        </div>
      </div>
      <div>
        <label className={LABEL_CLASS}>Address (optional)</label>
        <textarea value={form.address} onChange={update('address')} rows={2} maxLength={500} className={FIELD_CLASS} />
      </div>

      {error && <p className="rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-500">{error}</p>}

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          Add customer
        </Button>
      </div>
    </form>
  );
}

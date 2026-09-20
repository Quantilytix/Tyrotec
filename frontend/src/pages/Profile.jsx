import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';

const FIELD_CLASS =
  'mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-teal-500';
const LABEL_CLASS = 'block text-xs font-medium text-slate-600';

export default function Profile() {
  const { user, updateProfile } = useAuth();
  const [companyName, setCompanyName] = useState(user?.company_name || '');
  const [fullName, setFullName] = useState(user?.full_name || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [vatNumber, setVatNumber] = useState(user?.vat_number || '');
  const [isVatRegistered, setIsVatRegistered] = useState(Boolean(user?.is_vat_registered));
  const [address, setAddress] = useState(user?.address || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaved(false);
    setSaving(true);
    try {
      await updateProfile({
        company_name: companyName,
        full_name: fullName,
        phone,
        vat_number: vatNumber,
        is_vat_registered: isVatRegistered,
        address,
      });
      setSaved(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save your details.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h1 className="font-display text-xl font-semibold text-ink">Profile</h1>
      <p className="mt-1 text-sm text-slate-500">Manage your account details.</p>

      <Card className="mt-6 max-w-md p-6">
        <p className="text-sm text-slate-500">Email</p>
        <p className="font-medium text-ink">{user?.email}</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className={LABEL_CLASS}>Company name</label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className={FIELD_CLASS}
              placeholder="Acme Inc."
            />
          </div>

          <div>
            <label className={LABEL_CLASS}>Contact name</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className={FIELD_CLASS}
              placeholder="Who we should address on quotes/orders"
            />
          </div>

          <div>
            <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
              <input
                type="checkbox"
                checked={isVatRegistered}
                onChange={(e) => setIsVatRegistered(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              />
              My business is VAT-registered
            </label>
            {isVatRegistered && (
              <input
                type="text"
                required
                value={vatNumber}
                onChange={(e) => setVatNumber(e.target.value)}
                className={FIELD_CLASS}
                placeholder="VAT number"
              />
            )}
          </div>

          <div>
            <label className={LABEL_CLASS}>Address</label>
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows={3}
              className={FIELD_CLASS}
              placeholder={'Street, city, postal code'}
            />
            <p className="mt-1 text-xs text-slate-400">Shown on your downloaded quotations.</p>
          </div>

          <div>
            <label className={LABEL_CLASS}>WhatsApp / phone number</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={FIELD_CLASS}
              placeholder="Include country code, e.g. 27821234567"
            />
            <p className="mt-1 text-xs text-slate-400">
              Linking this lets you browse products, build quotes, and place orders over WhatsApp using
              this same account. Message our WhatsApp number once it's saved and we'll recognize you.
            </p>
          </div>

          {error && <p className="rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-500">{error}</p>}
          {saved && <p className="rounded-lg bg-good-50 px-3 py-2 text-sm text-good-500">Details saved.</p>}

          <Button type="submit" loading={saving}>
            Save
          </Button>
        </form>
      </Card>
    </div>
  );
}

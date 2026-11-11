import { useState } from 'react';
import Button from './ui/Button';
import { formatCurrency } from '../utils/formatters';

const FIELD_CLASS =
  'mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-teal-500';
const LABEL_CLASS = 'block text-xs font-medium text-slate-600';

// Staff-only. There is no customer equivalent of this form: a customer pays
// through Paystack, and money that arrives any other way is recorded by
// whoever can actually see it land in the bank. That's why there's no proof
// upload here either -- the person filling this in is the verification.
const METHODS = [
  { value: 'bank_transfer', label: 'Bank transfer / EFT' },
  { value: 'cash', label: 'Cash' },
  { value: 'card_machine', label: 'Card machine (in store)' },
  { value: 'other', label: 'Other' },
];

// saleName: what's being paid, as shown on its page ("Order #57", "Invoice INV-0003").
// waitingForStock: the sale can't be approved yet, so it stays waiting, already paid.
export default function RecordPaymentForm({ defaultAmount, saleName, waitingForStock = false, onSubmit, onCancel }) {
  const [method, setMethod] = useState('bank_transfer');
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState(defaultAmount);
  const [note, setNote] = useState('');
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await onSubmit({ method, reference, amount: Number(amount), note: note || null, notify_customer: notifyCustomer });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not record this payment.');
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
        Only record a payment you have already confirmed in the bank.{' '}
        {waitingForStock ? (
          <>
            {saleName} is still waiting for stock: the payment is recorded now, and it's marked as{' '}
            <strong>paid</strong> as soon as the stock arrives.
          </>
        ) : (
          <>
            {saleName} will be marked as <strong>paid</strong> straight away.
          </>
        )}
      </p>

      <div>
        <label className={LABEL_CLASS}>How was it paid?</label>
        <select value={method} onChange={(e) => setMethod(e.target.value)} className={FIELD_CLASS}>
          {METHODS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={LABEL_CLASS}>Reference</label>
        <input
          required
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          className={FIELD_CLASS}
          placeholder="Bank reference, receipt number, or how you identified this payment"
        />
      </div>

      <div>
        <label className={LABEL_CLASS}>Amount received</label>
        <input
          required
          type="number"
          step="0.01"
          min="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={FIELD_CLASS}
        />
        <p className="mt-1 text-xs text-slate-400">
          Order total is {formatCurrency(defaultAmount)} including VAT.
        </p>
      </div>

      <div>
        <label className={LABEL_CLASS}>Note (optional)</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={FIELD_CLASS} />
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={notifyCustomer}
          onChange={(e) => setNotifyCustomer(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
        />
        Send the customer a payment confirmation
      </label>

      {error && <p className="rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-500">{error}</p>}

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          Record payment
        </Button>
      </div>
    </form>
  );
}

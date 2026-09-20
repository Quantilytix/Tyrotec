import { useState } from 'react';
import Button from '../ui/Button';
import { formatCurrency } from '../../utils/formatters';

// Shown the moment a staff member finishes building a quote for a customer.
//
// The two things anyone actually wants next are "send it to them" and "give me
// the PDF" -- offering both here saves opening the quote, then hunting for the
// buttons. Emailing reports its outcome in place rather than navigating away,
// because "did that send?" is the whole question being answered.
export default function QuoteCreatedModal({ quote, customer, onEmail, onDownload, onView, onClose }) {
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState('');
  const [error, setError] = useState('');

  const handleEmail = async () => {
    setError('');
    setSending(true);
    try {
      const { to } = await onEmail();
      setSentTo(to);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not email this quote.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-good-50 px-3 py-3 text-sm">
        <p className="font-medium text-good-500">Quote #{quote.quoteNumber} created</p>
        <p className="mt-0.5 text-slate-600">
          {customer?.company_name || customer?.email} · {formatCurrency(quote.total_amount)} incl. VAT
        </p>
      </div>

      {sentTo ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          Emailed to <span className="font-medium text-ink">{sentTo}</span> with the quotation attached.
        </p>
      ) : (
        <p className="text-sm text-slate-500">
          Send it to {customer?.email || 'the customer'} now, or download the PDF to send yourself.
        </p>
      )}

      {error && <p className="rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-500">{error}</p>}

      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" onClick={onDownload}>
          Download PDF
        </Button>
        {!sentTo && (
          <Button onClick={handleEmail} loading={sending} disabled={!customer?.email}>
            Email to customer
          </Button>
        )}
        <Button variant={sentTo ? 'primary' : 'secondary'} onClick={onView}>
          Open quote
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

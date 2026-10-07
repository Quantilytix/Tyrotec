import { useState } from 'react';
import Button from '../ui/Button';
import { formatCurrency } from '../../utils/formatters';

// Shown the moment a staff member finishes building a quote for a customer.
//
// The two things anyone actually wants next are "send it to them" and "give me
// the PDF" -- offering both here saves opening the quote, then hunting for the
// buttons. Emailing reports its outcome in place rather than navigating away,
// because "did that send?" is the whole question being answered.
export default function QuoteCreatedModal({
  quote,
  customer,
  onEmail,
  onDownload,
  onView,
  onConvert,
  onClose,
}) {
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState('');
  const [error, setError] = useState('');
  const [converting, setConverting] = useState(false);

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

  // For a customer who agreed the price by email and is simply paying, the
  // quote and the order are one errand. Offering it here saves reopening the
  // quote to do the obvious next thing.
  const handleConvert = async () => {
    setError('');
    setConverting(true);
    try {
      await onConvert();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not convert this quote.');
      setConverting(false);
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
          Send it to {customer?.email || 'the customer'} now, or download the PDF to send yourself. If
          the price is already agreed, convert it straight to an order.
        </p>
      )}

      {error && <p className="rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-500">{error}</p>}

      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" onClick={onClose} disabled={converting}>
          Close
        </Button>
        <Button variant="secondary" onClick={onDownload} disabled={converting}>
          Download PDF
        </Button>
        <Button variant="secondary" onClick={onView} disabled={converting}>
          Open quote
        </Button>
        {!sentTo && (
          <Button
            variant={sentTo ? 'secondary' : 'primary'}
            onClick={handleEmail}
            loading={sending}
            disabled={!customer?.email || converting}
          >
            Email to customer
          </Button>
        )}
        {onConvert && (
          <Button onClick={handleConvert} loading={converting} disabled={sending}>
            Convert to order
          </Button>
        )}
      </div>
    </div>
  );
}

import { useState } from 'react';
import ConfirmDialog from '../ui/ConfirmDialog';
import { deleteRecord } from '../../api/recentlyDeleted';

// "Delete" from any list's Actions menu (admin only): moves the record to
// Recently deleted, where it can be restored for 30 days. If the server
// refuses (a finished sale, a purchase whose stock was sold, a customer who
// still has invoices), its reason shows here.
//
// type: 'quote' | 'order' | 'purchase' | 'customer'. what: extra words on
// what deleting this one does, e.g. that an open invoice is cancelled first.
export default function DeleteToBinDialog({ type, id, name, what = '', onDeleted, onCancel }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      const { data } = await deleteRecord(type, id);
      await onDeleted(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not delete it.');
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      title={`Delete ${name}?`}
      message={
        <>
          {what && <span className="mb-2 block">{what}</span>}
          It goes to Recently deleted, where an admin can restore it for 30 days.
          {error && <span className="mt-3 block rounded-lg bg-bad-50 px-3 py-2 text-bad-500">{error}</span>}
        </>
      }
      confirmLabel="Delete"
      onConfirm={confirm}
      onCancel={onCancel}
      loading={busy}
    />
  );
}

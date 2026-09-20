import { useState } from 'react';
import Button from '../ui/Button';
import { ROLE_LABELS } from '../../utils/roles';

// Invite a new staff member. The resulting link is shown once, on success:
// only its hash is stored, so it can't be looked up again later. If email
// delivery isn't set up yet, copying this link is how the person gets in.
const FIELD =
  'mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-teal-500';
const LABEL = 'block text-xs font-medium text-slate-600';

export default function InviteStaffModal({ onInvite, canInviteSuperAdmin, onClose }) {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('sales_rep');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      setResult(await onInvite({ email, full_name: fullName || null, role }));
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create this invitation.');
    } finally {
      setSaving(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(result.link);
      setCopied(true);
    } catch {
      // Clipboard can be blocked; the link is on screen to copy by hand.
      setCopied(false);
    }
  };

  if (result) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-ink">
          Invitation created for <span className="font-medium">{result.invite.email}</span> as{' '}
          {ROLE_LABELS[result.invite.role]}.
        </p>
        <div>
          <label className={LABEL}>Their sign-up link</label>
          <textarea
            readOnly
            value={result.link}
            rows={3}
            onFocus={(e) => e.target.select()}
            className={`${FIELD} font-mono text-xs`}
          />
          <p className="mt-1 text-xs text-slate-500">
            Send this to them. It works once, expires in 7 days, and can't be shown again — if it's lost,
            cancel the invitation and send a new one.
          </p>
        </div>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={copyLink}>
            {copied ? 'Copied ✓' : 'Copy link'}
          </Button>
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className={LABEL}>Email</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={FIELD}
          placeholder="name@tyrotec.co.za"
        />
      </div>
      <div>
        <label className={LABEL}>Full name (optional)</label>
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={FIELD} />
      </div>
      <div>
        <label className={LABEL}>Role</label>
        <select value={role} onChange={(e) => setRole(e.target.value)} className={FIELD}>
          <option value="sales_rep">{ROLE_LABELS.sales_rep}</option>
          <option value="admin">{ROLE_LABELS.admin}</option>
          {canInviteSuperAdmin && <option value="super_admin">{ROLE_LABELS.super_admin}</option>}
        </select>
      </div>

      {error && <p className="rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-500">{error}</p>}

      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" loading={saving} disabled={!email}>
          Create invitation
        </Button>
      </div>
    </form>
  );
}

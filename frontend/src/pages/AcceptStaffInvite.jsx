import { useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { acceptStaffInvite } from '../api/staff';
import AuthLayout from '../components/layout/AuthLayout';
import Button from '../components/ui/Button';

// Where an invited staff member lands from their link. The token in the URL is
// the only credential; the account itself doesn't exist until they set a
// password here.
const FIELD =
  'mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-teal-500';
const LABEL = 'block text-xs font-medium text-slate-600';

export default function AcceptStaffInvite() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';

  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (password !== confirm) {
      setError('Those passwords don\'t match.');
      return;
    }

    setLoading(true);
    try {
      await acceptStaffInvite({ token, password, full_name: fullName || null });
      setDone(true);
      // Straight to sign-in rather than logging them in automatically: they
      // just chose a password, so using it once confirms it works.
      setTimeout(() => navigate('/login'), 2500);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not complete this invitation.');
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <AuthLayout title="Invitation link" subtitle="Something's missing">
        <p className="text-sm text-slate-600">
          This link is incomplete. Ask whoever invited you to send a new invitation.
        </p>
        <Link to="/login" className="mt-4 inline-block text-sm text-teal-600 hover:underline">
          Back to sign in
        </Link>
      </AuthLayout>
    );
  }

  if (done) {
    return (
      <AuthLayout title="You're all set" subtitle="Your staff account is ready">
        <p className="text-sm text-slate-600">Taking you to the sign-in page...</p>
        <Link to="/login" className="mt-4 inline-block text-sm text-teal-600 hover:underline">
          Sign in now
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Set up your staff account" subtitle="Choose a password to finish">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className={LABEL}>Your full name</label>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={FIELD} />
        </div>
        <div>
          <label className={LABEL}>Password</label>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={FIELD}
            placeholder="At least 8 characters"
          />
        </div>
        <div>
          <label className={LABEL}>Confirm password</label>
          <input
            type="password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={FIELD}
          />
        </div>

        {error && <p className="rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-500">{error}</p>}

        <Button type="submit" loading={loading} className="w-full">
          Create my account
        </Button>
      </form>
    </AuthLayout>
  );
}

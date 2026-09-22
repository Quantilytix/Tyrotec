import { useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { acceptStaffInvite } from '../api/staff';
import AuthLayout from '../components/layout/AuthLayout';
import Button from '../components/ui/Button';
import PasswordInput from '../components/ui/PasswordInput';

// Where an invited staff member lands from their link. The token in the URL is
// the only credential; the account itself doesn't exist until they set a
// password here.
//
// AuthLayout only supplies the video background and centring -- the white card
// is each page's own, the same way Login and Register build theirs. Without it
// the form sat straight on the dark overlay with see-through inputs.
const FIELD =
  'mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-ink outline-none transition-colors duration-150 focus:border-teal-500';
const LABEL = 'block text-xs font-medium text-slate-600';

function Card({ title, subtitle, children }) {
  return (
    <div className="rounded-2xl bg-white p-8 shadow-card">
      <div className="mb-8 flex items-center gap-2">
        <img src="/jamlea.jpg" alt="Tyrotec" className="h-10 w-20 object-contain" />
        <span className="font-display text-lg font-semibold text-ink">Tyrotec Portal</span>
      </div>
      <h1 className="font-display text-xl font-semibold text-ink">{title}</h1>
      <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
      {children}
    </div>
  );
}

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
      <AuthLayout>
        <Card title="Invitation link" subtitle="Something's missing">
          <p className="mt-6 text-sm text-slate-600">
            This link is incomplete. Ask whoever invited you to send a new invitation.
          </p>
          <Link to="/login" className="mt-4 inline-block text-sm text-teal-600 hover:underline">
            Back to sign in
          </Link>
        </Card>
      </AuthLayout>
    );
  }

  if (done) {
    return (
      <AuthLayout>
        <Card title="You're all set" subtitle="Your staff account is ready">
          <p className="mt-6 text-sm text-slate-600">Taking you to the sign-in page...</p>
          <Link to="/login" className="mt-4 inline-block text-sm text-teal-600 hover:underline">
            Sign in now
          </Link>
        </Card>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <Card title="Set up your staff account" subtitle="Choose a password to finish">
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className={LABEL}>Your full name</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={FIELD} />
          </div>
          <div>
            <label className={LABEL}>Password</label>
            <div className="mt-1">
              <PasswordInput
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
              />
            </div>
          </div>
          <div>
            <label className={LABEL}>Confirm password</label>
            <div className="mt-1">
              <PasswordInput
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
          </div>

          {error && <p className="rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-500">{error}</p>}

          <Button type="submit" loading={loading} className="w-full">
            Create my account
          </Button>
        </form>
      </Card>
    </AuthLayout>
  );
}

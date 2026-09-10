import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { resetPasswordRequest } from '../api/auth';
import Button from '../components/ui/Button';

// Supabase's reset email links here with the recovery token in the URL
// fragment (#access_token=...&type=recovery), not a query string -- read it
// straight from window.location.hash rather than useSearchParams.
function getAccessTokenFromHash() {
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
  return new URLSearchParams(hash).get('access_token');
}

export default function ResetPassword() {
  const navigate = useNavigate();
  const [accessToken] = useState(getAccessTokenFromHash);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await resetPasswordRequest(accessToken, password);
      navigate('/login');
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-card">
        <div className="mb-8 flex items-center gap-2">
          <img src="/jamlea.jpg" alt="Tyrotec" className="h-10 w-auto object-contain" />
          <span className="font-display text-lg font-semibold text-ink">Tyrotec Customer Portal</span>
        </div>

        <h1 className="font-display text-xl font-semibold text-ink">Set a new password</h1>

        {!accessToken ? (
          <p className="mt-4 text-sm text-bad-500">
            This reset link is invalid or has expired. Request a new one from the{' '}
            <Link to="/forgot-password" className="font-medium text-teal-600 hover:underline">
              forgot password
            </Link>{' '}
            page.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-600">New password</label>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500"
                placeholder="At least 8 characters"
              />
            </div>

            {error && <p className="rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-500">{error}</p>}

            <Button type="submit" loading={loading} className="w-full">
              Set password
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

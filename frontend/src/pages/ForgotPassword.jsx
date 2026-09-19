import { useState } from 'react';
import { Link } from 'react-router-dom';
import { forgotPasswordRequest } from '../api/auth';
import Button from '../components/ui/Button';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await forgotPasswordRequest(email);
    } finally {
      // Always show the same outcome regardless of success/failure -- the
      // backend intentionally responds identically whether or not the email
      // is registered, so this shouldn't reveal anything either.
      setSubmitted(true);
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-card">
        <div className="mb-8 flex items-center gap-2">
          <img src="/jamlea.jpg" alt="Tyrotec" className="h-10 w-auto object-contain" />
          <span className="font-display text-lg font-semibold text-ink">Tyrotec Portal</span>
        </div>

        <h1 className="font-display text-xl font-semibold text-ink">Reset your password</h1>

        {submitted ? (
          <p className="mt-4 text-sm text-slate-600">
            If that email is registered, we've sent a link to reset your password. Check your inbox.
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-slate-500">
              Enter your email and we'll send you a link to set a new password.
            </p>
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-500"
                  placeholder="name@example.com"
                />
              </div>
              <Button type="submit" loading={loading} className="w-full">
                Send reset link
              </Button>
            </form>
          </>
        )}

        <p className="mt-6 text-center text-sm text-slate-500">
          <Link to="/login" className="font-medium text-teal-600 hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

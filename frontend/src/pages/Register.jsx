import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Button from '../components/ui/Button';
import GoogleButton from '../components/ui/GoogleButton';
import AuthLayout from '../components/layout/AuthLayout';
import PasswordInput from '../components/ui/PasswordInput';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [companyName, setCompanyName] = useState('');
  const [vatNumber, setVatNumber] = useState('');
  const [isVatRegistered, setIsVatRegistered] = useState(false);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingMessage, setPendingMessage] = useState('');

  // Staff accounts are invite-only (an admin sends a link), so this page no
  // longer offers a staff option at all.

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await register(
        email,
        password,
        companyName,
        'customer',
        null,
        phone || null,
        vatNumber || null,
        isVatRegistered
      );
      if (result?.pending) {
        setPendingMessage(result.message);
      } else {
        navigate('/products');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <div className="rounded-2xl bg-white p-8 shadow-card">
        <div className="mb-8 flex items-center gap-2">
          <img src="/jamlea.jpg" alt="Tyrotec" className="h-10 w-20 object-contain" />
          <span className="font-display text-lg font-semibold text-ink">Portal</span>
        </div>

        {pendingMessage ? (
          <>
            <h1 className="font-display text-xl font-semibold text-ink">Request submitted</h1>
            <p className="mt-2 text-sm text-slate-500">{pendingMessage}</p>
            <p className="mt-6 text-center text-sm text-slate-500">
              <Link to="/login" className="font-medium text-teal-600 hover:underline">
                Back to sign in
              </Link>
            </p>
          </>
        ) : (
          <>
            <h1 className="font-display text-xl font-semibold text-ink">Create your account</h1>
            <p className="mt-1 text-sm text-slate-500">
              Start browsing products and building quotes.
            </p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600">Company name</label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-teal-500"
                  placeholder="Acme Inc."
                />
              </div>
              <div>
                {/* Prices exclude VAT and VAT is charged either way; this
                    records who can claim it back, and puts their VAT
                    number on their quotes and receipts. */}
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
                    className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-teal-500"
                    placeholder="VAT number"
                  />
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-teal-500"
                  placeholder="name@example.com"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600">Phone (optional)</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-teal-500"
                  placeholder="Include country code, e.g. 27821234567"
                />
                <p className="mt-1 text-xs text-slate-400">Lets you also order via WhatsApp using this same account.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600">Password</label>
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

              {error && (
                <p className="rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-500">{error}</p>
              )}

              <Button type="submit" loading={loading} className="w-full">
                Create account
              </Button>
            </form>

            <div className="mt-4 flex items-center gap-3">
              <div className="h-px flex-1 bg-slate-200" />
              <span className="text-xs text-slate-400">or</span>
              <div className="h-px flex-1 bg-slate-200" />
            </div>
            <div className="mt-4">
              <GoogleButton />
            </div>

            <p className="mt-6 text-center text-sm text-slate-500">
              Already have an account?{' '}
              <Link to="/login" className="font-medium text-teal-600 hover:underline">
                Sign in
              </Link>
            </p>
          </>
        )}
      </div>

      <p className="mt-6 text-center text-xs font-light text-slate-300">
        Powered by Quantilytix ·{' '}
        <Link to="/privacy" className="underline hover:text-slate-100">
          Privacy Policy
        </Link>
      </p>
    </AuthLayout>
  );
}

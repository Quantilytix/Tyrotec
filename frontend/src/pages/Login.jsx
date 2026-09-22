import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Button from '../components/ui/Button';
import GoogleButton from '../components/ui/GoogleButton';
import AuthLayout from '../components/layout/AuthLayout';
import PasswordInput from '../components/ui/PasswordInput';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      // "/" runs HomeRedirect, which sends staff to /admin/products and
      // customers to /products -- login isn't customer-only like register,
      // so it can't hardcode either path.
      navigate('/');
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
          <span className="font-display text-lg font-semibold text-ink">Tyrotec  Portal</span>
        </div>

        <h1 className="font-display text-xl font-semibold text-ink">Sign in</h1>
        <p className="mt-1 text-sm text-slate-500">Access the customer portal</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
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
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium text-slate-600">Password</label>
              <Link to="/forgot-password" className="text-xs font-medium text-teal-600 hover:underline">
                Forgot password?
              </Link>
            </div>
            <div className="mt-1">
              <PasswordInput
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          {error && (
            <p className="rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-500">{error}</p>
          )}

          <Button type="submit" loading={loading} className="w-full">
            Sign in
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
          Don't have an account?{' '}
          <Link to="/register" className="font-medium text-teal-600 hover:underline">
            Create one
          </Link>
        </p>
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

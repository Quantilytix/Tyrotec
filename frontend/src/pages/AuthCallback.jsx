import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import supabase from '../lib/supabaseClient';
import Spinner from '../components/ui/Spinner';
import { takeNext } from '../utils/afterLogin';
import AuthLayout from '../components/layout/AuthLayout';

// Google redirects here (via Supabase) after the consent screen. By the time
// this page loads, the Supabase client (created fresh on this page load,
// with detectSessionInUrl on) has already parsed the tokens out of the URL --
// getSession() reliably waits for that to finish before resolving, which is
// why this doesn't need to parse the URL itself.
export default function AuthCallback() {
  const navigate = useNavigate();
  const { completeOAuthLogin } = useAuth();
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError('Could not complete Google sign-in. Try again.');
        return;
      }
      try {
        await completeOAuthLogin(session);
        // Back to where they were before Google, e.g. the quote builder.
        navigate(takeNext() || '/');
      } catch (err) {
        setError(err.response?.data?.error || 'Could not complete Google sign-in.');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthLayout>
      <div className="rounded-2xl bg-white p-8 text-center shadow-card">
        {error ? (
          <>
            <p className="text-sm text-bad-500">{error}</p>
            <p className="mt-4 text-sm text-slate-500">
              <Link to="/login" className="font-medium text-teal-600 hover:underline">
                Back to sign in
              </Link>
            </p>
          </>
        ) : (
          <>
            <Spinner />
            <p className="mt-4 text-sm text-slate-500">Signing you in...</p>
          </>
        )}
      </div>
    </AuthLayout>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/ui/Spinner';
import AuthLayout from '../components/layout/AuthLayout';
import { recordPage } from '../utils/qxLinks';

// QX sends staff here ("Open Tyrotec Portal") with a one-time code in the URL.
// The backend checks it with QX and, for an approved staff account, answers
// like a normal sign-in. The code works once and expires within a minute.
export default function QxSsoPage() {
  const navigate = useNavigate();
  const { completeQxLogin } = useAuth();
  const [error, setError] = useState('');
  // React's dev double-render would redeem the one-time code twice.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const destination = recordPage(params.get('entity'), params.get('ref'));
    // Take the code out of the address bar and history straight away.
    window.history.replaceState(null, '', '/sso/qx');
    if (!code) {
      setError('This link is missing its sign-in code. Open the portal from QX again.');
      return;
    }

    completeQxLogin(code)
      .then(() => navigate(destination, { replace: true }))
      .catch((err) => setError(err.response?.data?.error || 'Could not sign you in from QX. Try again from QX.'));
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
                Sign in with your portal password instead
              </Link>
            </p>
          </>
        ) : (
          <>
            <Spinner />
            <p className="mt-4 text-sm text-slate-500">Signing you in from QX...</p>
          </>
        )}
      </div>
    </AuthLayout>
  );
}

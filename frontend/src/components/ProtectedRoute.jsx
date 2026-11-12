import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { atLeast, isStaff } from '../utils/roles';
import { rememberNext } from '../utils/afterLogin';
import Spinner from './ui/Spinner';

// Signed-in only. A guest is sent to log in, and comes back here afterwards.
export default function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();
  const { pathname, search } = useLocation();

  if (loading) return <Spinner className="h-screen" />;
  if (!user) {
    rememberNext(pathname + search);
    return <Navigate to="/login" replace />;
  }
  // "/" runs HomeRedirect, which already knows the right landing page per
  // role -- hardcoding a specific path here (e.g. "/products") would loop
  // if that path is ever itself role-restricted to a role this user isn't.
  // Ranked: roles={['admin']} also admits a super admin (utils/roles.js).
  if (roles && !roles.some((role) => atLeast(user.role, role))) return <Navigate to="/" replace />;

  return children;
}

// The shop window: guests and customers. Staff have their own catalogue
// (/admin/products), so they're sent there instead.
export function ShopRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) return <Spinner className="h-screen" />;
  if (isStaff(user?.role)) return <Navigate to="/" replace />;
  return children;
}

// Open to everyone, signed in or not (Help, the quote builder, Sell on Tyrotec).
export function OpenRoute({ children }) {
  const { loading } = useAuth();

  if (loading) return <Spinner className="h-screen" />;
  return children;
}

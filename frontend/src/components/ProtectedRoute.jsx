import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { atLeast } from '../utils/roles';
import Spinner from './ui/Spinner';

export default function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth();

  if (loading) return <Spinner className="h-screen" />;
  if (!user) return <Navigate to="/login" replace />;
  // "/" runs HomeRedirect, which already knows the right landing page per
  // role -- hardcoding a specific path here (e.g. "/products") would loop
  // if that path is ever itself role-restricted to a role this user isn't.
  // Ranked: roles={['admin']} also admits a super admin (utils/roles.js).
  if (roles && !roles.some((role) => atLeast(user.role, role))) return <Navigate to="/" replace />;

  return children;
}

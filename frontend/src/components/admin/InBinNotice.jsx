import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { isAdmin } from '../../utils/roles';

// The banner on a record that's in Recently deleted. Only admins can open
// that page and restore things, so a sales rep is told who can instead of
// being given a link that goes nowhere.
//   subject: "This invoice"; detail: ": its stock was taken back off" (optional);
//   restoreHint: what restoring does, for admins ("Restore it there to ...").
export default function InBinNotice({ subject, detail = '', restoreHint, className = 'mt-4' }) {
  const { user } = useAuth();
  const admin = isAdmin(user?.role);

  return (
    <p className={`${className} rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-500`}>
      {subject} is in{' '}
      {admin ? (
        <Link to="/admin/recently-deleted" className="font-medium underline">
          Recently deleted
        </Link>
      ) : (
        <span className="font-medium">Recently deleted</span>
      )}
      {detail || '.'} {admin ? restoreHint : 'An admin can restore it.'}
    </p>
  );
}

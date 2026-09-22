import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function Topbar({ onMenuClick = () => {} }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const initials = (user?.company_name || user?.email || '?').slice(0, 2).toUpperCase();

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6 lg:justify-end lg:px-8">
      {/* Opens the nav drawer. Only exists below lg, where the sidebar has
          left the page flow. */}
      <button
        type="button"
        onClick={onMenuClick}
        className="-ml-1 rounded-lg p-2 text-slate-600 transition-colors duration-150 hover:bg-slate-100 lg:hidden"
        aria-label="Open menu"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-6 w-6">
          <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
        </svg>
      </button>

      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        {/* The company name and email are the first things to go when space
            is tight -- the avatar already identifies who is signed in. */}
        <div className="hidden min-w-0 text-right leading-tight sm:block">
          <p className="truncate text-sm font-medium text-ink">{user?.company_name || 'Your account'}</p>
          <p className="truncate text-xs text-slate-500">{user?.email}</p>
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-50 font-display text-xs font-semibold text-teal-600">
          {initials}
        </div>
        <button
          onClick={handleLogout}
          className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors duration-150 hover:bg-slate-50"
        >
          Log out
        </button>
      </div>
    </header>
  );
}

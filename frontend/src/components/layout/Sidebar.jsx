import { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useCart } from '../../context/CartContext';
import { useAuth } from '../../context/AuthContext';
import { isAdmin, isStaff } from '../../utils/roles';

const CUSTOMER_NAV_ITEMS = [
  { to: '/products', label: 'Products', icon: BoxIcon },
  { to: '/cart', label: 'Quote builder', icon: CartIcon, showCount: true },
  { to: '/quotes', label: 'Quotes', icon: DocIcon },
  { to: '/orders', label: 'Orders', icon: TruckIcon },
  { to: '/notifications', label: 'Notifications', icon: BellIcon },
  { to: '/profile', label: 'Profile', icon: ProfileIcon },
];

const STAFF_NAV_ITEMS = [
  { to: '/admin/products', label: 'Products', icon: BoxIcon },
  { to: '/admin/quotes', label: 'Quotes', icon: DocIcon },
  { to: '/admin/orders', label: 'Orders', icon: TruckIcon },
  { to: '/admin/payments', label: 'Payments', icon: CardIcon },
  { to: '/admin/reviews', label: 'Review queue', icon: FlagIcon },
  { to: '/admin/customers', label: 'Customers', icon: PeopleIcon },
  { to: '/admin/analytics', label: 'Analytics', icon: ChartIcon },
  { to: '/notifications', label: 'Notifications', icon: BellIcon },
];

const ADMIN_ONLY_NAV_ITEMS = [
  { to: '/admin/staff', label: 'Staff', icon: StaffIcon },
  { to: '/admin/activity-log', label: 'Activity log', icon: LogIcon },
];

export default function Sidebar({ open = false, onClose = () => {} }) {
  const { totalItems } = useCart();
  const { user } = useAuth();
  const { pathname } = useLocation();

  // Tapping a link on a phone should navigate *and* get the drawer out of the
  // way. Keyed on pathname rather than an onClick per link so it also covers
  // navigation that didn't come from a tap (a redirect, the back button).
  useEffect(() => {
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
  // Staff and admin navigation is rank-based: a super admin sees everything
  // an admin does, without this having to list the role separately.
  const navItems = isStaff(user?.role)
    ? isAdmin(user.role)
      ? [...STAFF_NAV_ITEMS, ...ADMIN_ONLY_NAV_ITEMS]
      : STAFF_NAV_ITEMS
    : CUSTOMER_NAV_ITEMS;

  return (
    <>
      {/* Dimmed backdrop, phones only -- tapping it closes the drawer. */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-ink/50 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex h-screen w-64 shrink-0 flex-col bg-ink text-white transition-transform duration-200 lg:static lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center gap-2 px-6 py-6">
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-5 rounded-md p-1.5 text-slate-300 hover:bg-white/10 hover:text-white lg:hidden"
            aria-label="Close menu"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-5 w-5">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
          <img
            src="/jamlea.jpg"
            alt="Tyrotec"
            className="h-11 w-20 rounded-lg border-2 border-yellow-400/80 bg-white p-1 object-contain"
          />
          <span className="font-display text-lg font-semibold tracking-tight">Portal</span>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {navItems.map(({ to, label, icon: Icon, showCount }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `group flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150 ${
                  isActive
                    ? 'bg-yellow-400/10 text-white'
                    : 'text-slate-300 hover:bg-white/5 hover:text-white'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span className="flex items-center gap-3">
                    <span className={`h-1 w-1 rounded-full bg-yellow-400 transition-opacity duration-150 ${isActive ? 'opacity-100' : 'opacity-0'}`} />
                    <Icon className="h-[18px] w-[18px]" />
                    {label}
                  </span>
                  {showCount && totalItems > 0 && (
                    <span className="rounded-full bg-yellow-400 px-1.5 py-0.5 text-xs font-semibold text-ink">
                      {totalItems}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

          <p className="px-6 py-4 text-xs font-light text-slate-500">Powered by Quantilytix</p>
      </aside>
    </>
  );
}

function BoxIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...props}>
      <path d="M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function CartIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...props}>
      <path d="M3 3h2l2.4 12.4a2 2 0 002 1.6h8.2a2 2 0 002-1.6L21 8H6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9" cy="21" r="1" /><circle cx="18" cy="21" r="1" />
    </svg>
  );
}
function DocIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...props}>
      <path d="M8 3h6l4 4v14H8V3z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 9h4M11 13h4M11 17h2" strokeLinecap="round" />
    </svg>
  );
}
function TruckIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...props}>
      <path d="M2 8h11v9H2zM13 11h4l3 3v3h-7z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="6.5" cy="19" r="1.5" /><circle cx="16.5" cy="19" r="1.5" />
    </svg>
  );
}
function BellIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...props}>
      <path d="M6 8a6 6 0 1112 0c0 5 2 6 2 6H4s2-1 2-6z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 21a2 2 0 004 0" strokeLinecap="round" />
    </svg>
  );
}
function FlagIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...props}>
      <path d="M5 21V4" strokeLinecap="round" />
      <path d="M5 4h13l-3 4 3 4H5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function CardIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...props}>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" strokeLinecap="round" />
      <path d="M6 15h4" strokeLinecap="round" />
    </svg>
  );
}
function PeopleIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...props}>
      <circle cx="8" cy="8" r="3" />
      <path d="M2 20c0-3.3 2.7-6 6-6s6 2.7 6 6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M15.5 13.3c2.6.4 4.5 2.6 4.5 5.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ChartIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...props}>
      <path d="M4 20V10M11 20V4M18 20v-7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 20h20" strokeLinecap="round" />
    </svg>
  );
}
function StaffIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...props}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 8a3 3 0 110-6M21 20c0-2.8-2-5.1-4.6-5.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function LogIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...props}>
      <path d="M4 4h16v16H4z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 9h8M8 13h8M8 17h5" strokeLinecap="round" />
    </svg>
  );
}
function ProfileIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

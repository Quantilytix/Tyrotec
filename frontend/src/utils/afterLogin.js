// Where to go back to after signing in. A guest who builds a quote and then
// has to log in (or create an account, or sign in with Google, which leaves
// the site and comes back) should land back on that page, not on the default
// one. Kept in sessionStorage so it survives the Google round trip but not a
// new visit.
const KEY = 'tyrotec_after_login';

// Only a path on this site: never an outside URL (an open redirect someone
// could send in a link), and not the sign-in pages themselves.
function isSafe(path) {
  return (
    typeof path === 'string' &&
    path.startsWith('/') &&
    !path.startsWith('//') &&
    !path.startsWith('/\\') &&
    !/^\/(login|register|auth\/)/.test(path)
  );
}

export function rememberNext(path) {
  if (!isSafe(path)) return;
  try {
    sessionStorage.setItem(KEY, path);
  } catch {
    // Storage unavailable: they land on the default page instead.
  }
}

// The remembered path, once: reading it clears it.
export function takeNext() {
  try {
    const path = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return isSafe(path) ? path : null;
  } catch {
    return null;
  }
}

// /login?next=/cart -> remembers /cart. For links that send a guest to sign in.
export function rememberNextFromQuery(search) {
  const next = new URLSearchParams(search).get('next');
  if (next) rememberNext(next);
}

export const loginPathFor = (path) => `/login?next=${encodeURIComponent(path)}`;
export const registerPathFor = (path) => `/register?next=${encodeURIComponent(path)}`;

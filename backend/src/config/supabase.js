const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
}

// Every call to Supabase gives up after 30 seconds. Without a limit, a
// stalled connection leaves the request waiting for ever: the change may
// already be saved, but the person never gets an answer. (supabase-js retries
// a timed-out read up to 3 times, so a read gives up after about 2 minutes;
// writes aren't retried.)
const REQUEST_TIMEOUT_MS = 30 * 1000;
function fetchWithTimeout(input, init = {}) {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return fetch(input, { ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
}

const OPTIONS = {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { fetch: fetchWithTimeout },
};

// Service-role client: used server-side only, bypasses RLS, also used to
// manage accounts (auth.admin.*). Never call auth.signInWithPassword() or
// auth.setSession() on this instance -- doing so swaps its in-memory session
// in, which then overrides the Authorization header on every subsequent
// .from()/.rpc() call made through this same shared client (for every
// request handled by the process, not just the caller's), silently
// downgrading privileged writes from service_role to that user's own role
// and tripping RLS. Use createScopedClient() for anything that signs in.
const supabase = createClient(supabaseUrl, supabaseKey, OPTIONS);

supabase.createScopedClient = () => createClient(supabaseUrl, supabaseKey, OPTIONS);

module.exports = supabase;

const supabase = require('../config/supabase');

// "What time is it?" answered by the database rather than by this process.
//
// Every deadline in this system is written and enforced by Postgres:
// stock_reservations.expires_at is now() + interval, and
// release_expired_reservations() compares against now() again. Measuring the
// time left against *this machine's* clock introduces a second, unrelated
// clock into that comparison -- and when the two disagree the countdown is
// wrong by exactly the difference. A developer machine running an hour fast
// made every reservation look expired the moment it was created.
//
// Rather than pay a round trip on every request, the difference between the
// two clocks is measured once and reused: it only changes when a machine's
// clock is adjusted, which is rare and slow.
const REFRESH_MS = 5 * 60 * 1000;

// Warn once when the host clock is far enough out to matter. Ten minutes is
// well beyond NTP jitter and well inside the 60-minute reservation window,
// so anything past it is a real misconfiguration worth saying out loud.
const SKEW_WARN_MS = 10 * 60 * 1000;

// dbNow = Date.now() - offsetMs. Zero until the first successful sync, which
// means an unsynced process behaves exactly as it did before -- no worse.
let offsetMs = 0;
let lastSyncedAt = 0;
let inFlight = null;
let warned = false;

function applySample(dbNowIso, localMs) {
  const dbMs = new Date(dbNowIso).getTime();
  if (!Number.isFinite(dbMs)) return false;
  offsetMs = localMs - dbMs;
  lastSyncedAt = Date.now();

  if (!warned && Math.abs(offsetMs) > SKEW_WARN_MS) {
    warned = true;
    console.warn(
      `This machine's clock is ${Math.round(offsetMs / 60000)} minute(s) ` +
        'off the database clock. Times are being corrected against the database, ' +
        'but the host clock should be synced (it affects tokens and logs too).'
    );
  }
  return true;
}

// Measures the offset. Concurrent callers share one round trip. A failure is
// logged and swallowed: a missing db_now() (migration 029 not yet applied)
// must degrade to the old behaviour, never break an order page.
// Postgres itself, via migration 029. The most direct answer available.
async function sampleFromRpc() {
  const sentAt = Date.now();
  const { data, error } = await supabase.rpc('db_now');
  if (error) throw new Error(error.message);
  // Mid-point of the round trip is the best estimate of "local time when the
  // database read its clock".
  return applySample(data, (sentAt + Date.now()) / 2);
}

// Every Supabase REST response carries a Date header, from the same
// infrastructure the database runs on. Less precise than asking Postgres,
// but it needs no migration -- so the countdown is right on a skewed host
// even before 029 has been applied.
async function sampleFromHttpDate() {
  const sentAt = Date.now();
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/`, {
    method: 'HEAD',
    headers: { apikey: (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim() },
  });
  const header = res.headers.get('date');
  if (!header) throw new Error('no Date header on the Supabase response');
  return applySample(header, (sentAt + Date.now()) / 2);
}

// Measures the offset. Concurrent callers share one round trip.
//
// Falls back rather than failing: if neither source can be read the offset
// stays where it was, which is no worse than the host clock alone. Nothing
// here may break the order page it is called from.
async function syncDbClock() {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      await sampleFromRpc();
    } catch (rpcErr) {
      try {
        await sampleFromHttpDate();
      } catch (httpErr) {
        console.error(
          `Could not read the database clock (${rpcErr.message}; ${httpErr.message}). ` +
            "Falling back to this host's clock."
        );
      }
    } finally {
      lastSyncedAt = Date.now();
      inFlight = null;
    }
  })();

  return inFlight;
}

// Current database time in milliseconds. Re-measures when the last sample is
// stale, otherwise answers immediately from the cached offset.
async function dbNowMs() {
  if (Date.now() - lastSyncedAt > REFRESH_MS) await syncDbClock();
  return Date.now() - offsetMs;
}

// Test/diagnostic seam.
function _reset() {
  offsetMs = 0;
  lastSyncedAt = 0;
  inFlight = null;
  warned = false;
}

module.exports = { dbNowMs, syncDbClock, _reset, REFRESH_MS, SKEW_WARN_MS };

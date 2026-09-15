// Runs the two reservation jobs inside the API process on a timer, for
// hosting without scheduled jobs (Render's Free plan has no Cron Jobs).
// Enabled by RUN_JOBS_IN_PROCESS=true in app.js.
//
// Only safe while exactly ONE API instance is running -- two instances would
// each run the jobs. That's always true on Render's Free plan. On a paid plan
// with Render Cron Jobs (see README), leave this off so the jobs don't run
// twice.
//
// While a Free service is spun down nothing runs; the first run after it
// wakes catches up on anything that expired in the meantime, since both
// Postgres functions select by expiry time rather than by "since last run".
const warnExpiringReservations = require('./warnExpiringReservations');
const releaseExpiredReservations = require('./releaseExpiredReservations');

const INTERVAL_MS = 5 * 60 * 1000;
// Short delay after boot so a service waking from spin-down releases stale
// reservations promptly, without competing with its own startup.
const FIRST_RUN_DELAY_MS = 30 * 1000;

function startInProcessJobs({ intervalMs = INTERVAL_MS, firstRunDelayMs = FIRST_RUN_DELAY_MS } = {}) {
  let running = false;

  const tick = async () => {
    // A slow run (e.g. Supabase briefly unreachable) must not stack a second
    // concurrent run on top of itself.
    if (running) return;
    running = true;
    try {
      // Warn before releasing, matching the order the cron schedules used.
      await warnExpiringReservations.run();
      await releaseExpiredReservations.run();
    } catch (err) {
      console.error('In-process reservation jobs failed:', err);
    } finally {
      running = false;
    }
  };

  const firstRun = setTimeout(tick, firstRunDelayMs);
  const interval = setInterval(tick, intervalMs);

  return function stop() {
    clearTimeout(firstRun);
    clearInterval(interval);
  };
}

module.exports = { startInProcessJobs, INTERVAL_MS };

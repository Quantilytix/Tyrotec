// A simple in-memory "N per window" limit per key (e.g. per signed-in user).
// Enough for one API instance; it resets on restart, which is fine for its
// one job here: stopping one person from running up AI costs.
function createRateLimiter({ limit, windowMs }) {
  const hits = new Map(); // key -> timestamps within the window

  return function check(key, now = Date.now()) {
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return { ok: false, retryAfterSeconds: Math.ceil((windowMs - (now - recent[0])) / 1000) };
    }
    recent.push(now);
    hits.set(key, recent);
    return { ok: true };
  };
}

module.exports = { createRateLimiter };

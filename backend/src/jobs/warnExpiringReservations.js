// Standalone script, not an Express route -- meant to run as a Render Cron
// Job (same shape as releaseExpiredReservations.js, just on its own separate
// schedule, e.g. every 5 minutes) invoking
// `node src/jobs/warnExpiringReservations.js`. Deliberately a second job
// rather than folded into the release job: this one's purpose is "warn
// before the clock runs out", the other's is "act once it has" -- keeping
// them separate means either can change schedule/logic without touching the
// other, and a bug in the warning path can never affect the actual
// restock/cancel path.
//
// The actual "which orders need a warning" logic (and marking them warned,
// atomically, so two overlapping runs can't double-send) happens inside the
// warn_expiring_reservations() Postgres function
// (020_reservation_expiry_warning.sql) -- this script's only job is to call
// it and send the customer notifications plpgsql can't send itself.

require('dotenv').config();
const supabase = require('../config/supabase');
const { notifyUser } = require('../services/notificationService');
const { dbNowMs } = require('../utils/dbClock');

const LEAD_MINUTES = Number(process.env.RESERVATION_WARNING_LEAD_MINUTES) || 10;

async function run() {
  const { data: dueOrderIds, error } = await supabase.rpc('warn_expiring_reservations', {
    p_lead_minutes: LEAD_MINUTES,
  });
  if (error) {
    console.error('warn_expiring_reservations failed:', error.message);
    process.exitCode = 1;
    return;
  }

  const orderIds = (dueOrderIds || []).map((row) => row.order_id);
  if (orderIds.length === 0) {
    console.log('No reservations nearing expiry.');
    return;
  }

  const { data: orders, error: ordersErr } = await supabase
    .from('orders')
    .select('id, order_number, customer_id, users(email, phone), stock_reservations(expires_at)')
    .in('id', orderIds);
  if (ordersErr) {
    console.error('Orders flagged, but could not load them to notify:', ordersErr.message);
    process.exitCode = 1;
    return;
  }

  // Same reasoning as the order page's countdown: expires_at came from
  // Postgres, so "how long is left" has to be measured against Postgres.
  const nowMs = await dbNowMs();

  for (const order of orders) {
    // All of an order's reservation rows share one expires_at (set together,
    // in one call, by checkout_quote_with_reservation) -- any row's value is
    // the order's value.
    const expiresAt = order.stock_reservations?.[0]?.expires_at;
    const minutesLeft = expiresAt ? Math.max(1, Math.round((new Date(expiresAt).getTime() - nowMs) / 60000)) : LEAD_MINUTES;

    await notifyUser({
      userId: order.customer_id,
      type: 'order_status_changed',
      title: 'Your reservation is about to expire',
      message: `Your stock reservation for order #${order.order_number} expires in about ${minutesLeft} minute(s). Complete payment now or the stock will be released and the order cancelled.`,
      relatedType: 'order',
      relatedId: order.id,
      email: order.users?.email,
      phone: order.users?.phone,
    });
  }

  console.log(`Warned ${orderIds.length} order(s) nearing reservation expiry: ${orderIds.join(', ')}`);
}

// Only auto-runs when executed directly -- same reasoning as
// releaseExpiredReservations.js: requiring this module for an unrelated
// reason (a test, a tool sweeping every file in src/) must never silently
// fire it for real against production data.
if (require.main === module) {
  run()
    .then(() => {
      process.exitCode = process.exitCode || 0;
    })
    .catch((err) => {
      console.error('warnExpiringReservations job crashed:', err);
      process.exitCode = 1;
    });
}

module.exports = { run };

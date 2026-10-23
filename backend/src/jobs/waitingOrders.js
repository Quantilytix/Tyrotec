// Standalone script, same shape as releaseExpiredReservations.js: run by the
// in-process scheduler on the Free plan, or as a Render Cron Job
// (`node src/jobs/waitingOrders.js`) every few minutes.
//
// 1. Gives stock to waiting orders. The database already does this whenever
//    stock goes up (037's trigger); running it here too catches an order
//    that started waiting a moment after the stock arrived.
// 2. Tells customers whose waiting order got stock.
// 3. Cancels approved orders not paid by their deadline, and tells them.

require('dotenv').config();
const supabase = require('../config/supabase');
const { notifyStockArrivals, cancelOverdueUnpaidOrders } = require('../services/waitingOrderService');

async function run() {
  const { error } = await supabase.rpc('allocate_stock_to_waiting_orders');
  if (error) {
    console.error('allocate_stock_to_waiting_orders failed:', error.message);
    process.exitCode = 1;
  }

  const notified = await notifyStockArrivals();
  if (notified.length) console.log(`Told ${notified.length} customer(s) their stock arrived: ${notified.join(', ')}`);

  const cancelled = await cancelOverdueUnpaidOrders();
  if (cancelled.length) console.log(`Cancelled ${cancelled.length} unpaid order(s) past their deadline: ${cancelled.join(', ')}`);
}

// Only auto-runs when executed directly, never when merely required (see
// releaseExpiredReservations.js for why).
if (require.main === module) {
  run()
    .then(() => {
      process.exitCode = process.exitCode || 0;
    })
    .catch((err) => {
      console.error('waitingOrders job crashed:', err);
      process.exitCode = 1;
    });
}

module.exports = { run };

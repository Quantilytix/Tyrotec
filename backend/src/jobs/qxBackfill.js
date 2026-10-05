// One-off: queues every existing record (customers, suppliers, products,
// quotes, orders, payments, purchases, adjustments, opening stock) to be sent
// to QX. The regular sync then sends them, 200 at a time. Safe to run again:
// QX skips records it already has.
//
//   node src/jobs/qxBackfill.js

require('dotenv').config();
const supabase = require('../config/supabase');
const { syncEnabled } = require('../services/qxSyncService');

async function main() {
  const { data, error } = await supabase.rpc('qx_enqueue_all');
  if (error) {
    console.error('Could not queue records for QX:', error.message);
    process.exitCode = 1;
    return;
  }
  console.log(`Queued ${data} record(s) for QX. The sync job sends them over the next few runs.`);
  if (!syncEnabled()) console.log('Note: QX_SYNC_ENABLED is not "true", so nothing is sent until it is.');
}

main();

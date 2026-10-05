// Sends queued changes to QX. Runs every 5 minutes inside the API
// (inProcessScheduler.js) on the Free plan, or as a Render Cron Job on a paid
// plan: `node src/jobs/syncToQx.js`. Does nothing until QX_CONNECT_URL,
// QX_CONNECT_KEY and QX_SYNC_ENABLED=true are set. See services/qxSyncService.js.

require('dotenv').config();
const { runQxSync } = require('../services/qxSyncService');

async function run() {
  try {
    const result = await runQxSync();
    if (result.reason === 'not_connected') console.log('QX sync is off (QX_CONNECT_URL / QX_CONNECT_KEY not set).');
    if (result.reason === 'sync_disabled') console.log('QX sync is off (QX_SYNC_ENABLED is not "true"); changes keep queuing.');
  } catch (err) {
    console.error('QX sync failed:', err.message || err);
    process.exitCode = 1;
  }
}

module.exports = { run };

if (require.main === module) {
  run();
}

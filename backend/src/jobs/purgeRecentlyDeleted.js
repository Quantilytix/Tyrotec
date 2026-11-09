// Clears Recently deleted of what's past its 30 days (046_recently_deleted.sql):
// deleted quotes, and deleted customers with no orders, go for good. Run by
// the in-process scheduler, or as a Render Cron Job
// (`node src/jobs/purgeRecentlyDeleted.js`). Opening the Recently deleted
// page does the same, so running late is harmless.

require('dotenv').config();
const { purgeRecentlyDeleted } = require('../services/recentlyDeletedService');

async function run() {
  const removed = await purgeRecentlyDeleted();
  if (removed > 0) console.log(`Recently deleted: removed ${removed} customer(s) for good.`);
}

if (require.main === module) {
  run()
    .then(() => {
      process.exitCode = process.exitCode || 0;
    })
    .catch((err) => {
      console.error('purgeRecentlyDeleted job crashed:', err);
      process.exitCode = 1;
    });
}

module.exports = { run };

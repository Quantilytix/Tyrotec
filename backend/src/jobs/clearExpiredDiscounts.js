// Takes discounts past their last day off products (038_discounts.sql). Run
// by the in-process scheduler, or as a Render Cron Job
// (`node src/jobs/clearExpiredDiscounts.js`). Pricing checks the last day
// itself, so this only keeps the catalogue tidy; running late is harmless.

require('dotenv').config();
const { clearExpiredDiscounts } = require('../services/discountService');

async function run() {
  await clearExpiredDiscounts();
}

if (require.main === module) {
  run()
    .then(() => {
      process.exitCode = process.exitCode || 0;
    })
    .catch((err) => {
      console.error('clearExpiredDiscounts job crashed:', err);
      process.exitCode = 1;
    });
}

module.exports = { run };

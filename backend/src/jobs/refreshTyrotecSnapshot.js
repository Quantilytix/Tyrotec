// Saves a fresh copy of the Tyrotec website's text to
// src/data/tyrotecWebsite.txt: the copy the Help chat falls back to when the
// live site can't be reached (services/tyrotecKnowledge.js). Run it after the
// website changes, and commit the file:
//
//   node src/jobs/refreshTyrotecSnapshot.js

const fs = require('fs');
const path = require('path');
const { crawlSite, SNAPSHOT_FILE, SITE } = require('../services/tyrotecKnowledge');

async function run() {
  const text = await crawlSite();
  fs.mkdirSync(path.dirname(SNAPSHOT_FILE), { recursive: true });
  const header = `# Text of ${SITE}, saved ${new Date().toISOString().slice(0, 10)} for the Help chat.\n# Refresh: node src/jobs/refreshTyrotecSnapshot.js\n\n`;
  fs.writeFileSync(SNAPSHOT_FILE, header + text + '\n', 'utf8');
  console.log(`Saved ${text.length} characters from ${SITE} to ${SNAPSHOT_FILE}`);
}

if (require.main === module) {
  run().catch((err) => {
    console.error('Could not refresh the Tyrotec website copy:', err.message);
    process.exitCode = 1;
  });
}

module.exports = { run };

// What the Help chat knows about Tyrotec: the text of the Tyrotec website,
// read straight from https://www.tyrotec.co.za and kept for a day, so changes
// on the site reach the chat without a code change.
//
// If the site can't be reached, the last copy read is used, or failing that
// the copy saved with the app (data/tyrotecWebsite.txt, refreshed with
// `node src/jobs/refreshTyrotecSnapshot.js`), so the chat never goes quiet
// because the website is down.

const fs = require('fs');
const path = require('path');
const { htmlToText, sameSiteLinks } = require('../utils/htmlText');

const SITE = process.env.TYROTEC_WEBSITE_URL || 'https://www.tyrotec.co.za/';
const SNAPSHOT_FILE = path.join(__dirname, '..', 'data', 'tyrotecWebsite.txt');
const CACHE_MS = 24 * 60 * 60 * 1000;
const MAX_PAGES = 15;
const MAX_CHARS = 40000; // plenty for a small site; keeps the AI prompt bounded
const PAGE_TIMEOUT_MS = 10000;

let cache = null; // { text, readAt }
let inFlight = null;

async function fetchPage(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { signal: controller.signal, headers: { 'User-Agent': 'TyrotecPortal-Help/1.0' } });
    if (!res.ok) return null;
    if (!/text\/html/i.test(res.headers.get('content-type') || 'text/html')) return null;
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// Reads the site: the home page, then the pages it links to, one level at a
// time, up to MAX_PAGES. Returns the combined text, one section per page.
async function crawlSite(fetchImpl = fetch, start = SITE) {
  const queue = [new URL(start).toString()];
  const seen = new Set(queue);
  const sections = [];
  let length = 0;
  while (queue.length && sections.length < MAX_PAGES && length < MAX_CHARS) {
    const url = queue.shift();
    const html = await fetchPage(url, fetchImpl).catch(() => null);
    if (!html) continue;
    const { title, text } = htmlToText(html);
    if (text) {
      const section = `=== ${title || 'Page'} (${url}) ===\n${text}`;
      sections.push(section);
      length += section.length;
    }
    for (const link of sameSiteLinks(html, url)) {
      if (!seen.has(link)) {
        seen.add(link);
        queue.push(link);
      }
    }
  }
  if (sections.length === 0) throw new Error('The Tyrotec website could not be read.');
  return sections.join('\n\n').slice(0, MAX_CHARS);
}

function snapshotText() {
  try {
    return fs.readFileSync(SNAPSHOT_FILE, 'utf8');
  } catch {
    return '';
  }
}

// The website text, from the day's cache, the live site, or a saved copy.
async function getWebsiteKnowledge({ fetchImpl = fetch, now = Date.now() } = {}) {
  if (cache && now - cache.readAt < CACHE_MS) return cache.text;
  if (!inFlight) {
    inFlight = crawlSite(fetchImpl)
      .then((text) => {
        cache = { text, readAt: Date.now() };
        return text;
      })
      .catch((err) => {
        console.error('Help chat: could not read the Tyrotec website, using the saved copy:', err.message);
        return cache?.text || snapshotText();
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

// For tests.
function resetCache() {
  cache = null;
  inFlight = null;
}

module.exports = { getWebsiteKnowledge, crawlSite, snapshotText, resetCache, SNAPSHOT_FILE, SITE };

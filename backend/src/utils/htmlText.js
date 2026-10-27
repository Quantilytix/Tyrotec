// Plain text and same-site links from a web page, for the Help chat's
// knowledge of the Tyrotec website (services/tyrotecKnowledge.js). No HTML
// parser dependency: the site is simple static HTML, and this only has to
// keep the words in reading order.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

// The page title and its readable text, with headings and blocks on their own
// lines. Scripts, styles and SVG drawings are dropped.
function htmlToText(html) {
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '').trim();
  let s = String(html)
    .replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(h[1-6])[^>]*>/gi, '\n\n## ')
    .replace(/<\/(h[1-6]|p|div|section|article|header|footer|li|tr|ul|ol|table|br)\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s)
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .filter((line) => line && line !== '-' && line !== '##')
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
  return { title: decodeEntities(title), text: s.trim() };
}

// Links on a page that stay on the same site, as absolute URLs without the
// #fragment. mailto:, tel:, files and other sites are left out.
function sameSiteLinks(html, pageUrl) {
  const base = new URL(pageUrl);
  const links = new Set();
  for (const match of String(html).matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#]*)(?:#[^"']*)?["']/gi)) {
    const href = match[1].trim();
    if (!href || /^(mailto|tel|javascript):/i.test(href)) continue;
    let url;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (url.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) continue;
    if (/\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?)$/i.test(url.pathname)) continue;
    url.hash = '';
    url.search = '';
    // "/index.html" is the same page as "/".
    url.pathname = url.pathname.replace(/\/index\.html?$/i, '/');
    links.add(url.toString());
  }
  return [...links];
}

module.exports = { htmlToText, sameSiteLinks, decodeEntities };

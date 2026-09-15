// Branding and layout pieces shared by every customer-facing PDF the portal
// generates (generateQuotePdf.js, generateReceiptPdf.js), so a quotation and
// a receipt for the same order visibly come from the same company. The
// backend's own quote-PDF generator (backend/src/services/quotePdfService.js)
// is a separate copy of the quotation layout -- keep it in sync by hand.
//
// Colors below are lifted straight from this app's own design tokens
// (src/index.css's @theme block) rather than picked fresh, so a downloaded
// document actually looks like it came from the portal the customer is logged
// into -- ink/navy/canvas/good/bad/amber are that file's exact hex values
// converted to RGB triples, not a separate palette invented here.

// Seller details shown in the document's "FROM" panel and footer. Only
// `name` and `tagline` are known for sure right now -- the rest render as
// blank lines (nothing fabricated) until real values are filled in here, at
// which point they show up automatically on every document. bankDetails is a
// plain array of lines (e.g. bank name, account number, branch code) printed
// under a quote's Terms so a customer paying by EFT has somewhere to copy
// them from.
export const COMPANY = {
  name: 'Tyrotec',
  tagline: 'Supplier for industrial parts and supplies',
  address: '',
  phone: '',
  email: '',
  website: '',
  vatNumber: '',
  bankDetails: [],
};

export const INK = [16, 25, 43]; // --color-ink
export const NAVY = [30, 58, 102]; // --color-teal-500 (the portal's primary action color)
export const NAVY_TINT = [234, 240, 251]; // --color-teal-50
export const CANVAS = [245, 246, 248]; // --color-canvas
export const GOOD = [21, 128, 61]; // --color-good-500
export const GOOD_TINT = [240, 253, 244]; // tailwind green-50, the portal's "paid/approved" badge background
export const AMBER = [217, 119, 6]; // tailwind amber-600, matches StatusBadge's amber quote-status color
export const GRAY = [100, 116, 139]; // tailwind slate-500, the portal's secondary-text color
export const BORDER = [226, 232, 240]; // tailwind slate-200, the portal's card-border color
const HEADER_TEXT_TINT = [203, 213, 225]; // tailwind slate-300, same as the sidebar's own text-on-ink color
const ACCENT_YELLOW = [250, 204, 21]; // tailwind yellow-400, the portal's active-nav/cart-badge accent

export const MARGIN = 14;
export const PAGE_WIDTH = 210;
// Space autoTable must leave clear at the bottom of every page for drawFooter.
export const FOOTER_CLEARANCE = 26;

// Document dates are day-only -- unlike formatters.js's formatDate (used for
// timestamped activity/notification lists), a document header shouldn't show
// a time-of-day next to "Date Issued" or "Date Paid".
export function formatDocDate(isoString) {
  return new Date(isoString).toLocaleDateString('en-ZA', { year: 'numeric', month: 'short', day: 'numeric' });
}

// "Tyrotec" -> "TT": pulls the capitals out of the brand name for a simple
// text fallback if the logo image failed to load, so the header still has
// *something* logo-shaped rather than an empty box.
function monogram(name) {
  const capitals = (name.match(/[A-Z]/g) || []).slice(0, 2).join('');
  return capitals.length >= 2 ? capitals : name.slice(0, 2).toUpperCase();
}

// Fetched once per page load and cached -- every call after the first reuses
// the same promise instead of re-fetching the file. Resolves to null (rather
// than rejecting) if the logo can't be loaded, so drawHeader can fall back to
// a text monogram instead of the whole PDF generation failing.
let logoDataUriPromise = null;
export function getLogoDataUri() {
  if (!logoDataUriPromise) {
    logoDataUriPromise = fetch('/logo-square.png')
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error('logo fetch failed'))))
      .then(
        (blob) =>
          new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          })
      )
      .catch(() => null);
  }
  return logoDataUriPromise;
}

// title: the document type printed top-right, e.g. 'QUOTATION' or 'RECEIPT'.
export function drawHeader(doc, logoDataUri, title) {
  doc.setFillColor(...ACCENT_YELLOW);
  doc.rect(0, 0, PAGE_WIDTH, 2, 'F');

  doc.setFillColor(...INK);
  doc.rect(0, 2, PAGE_WIDTH, 34, 'F');

  doc.setFillColor(255, 255, 255);
  doc.roundedRect(MARGIN, 10, 18, 18, 3, 3, 'F');
  if (logoDataUri) {
    doc.addImage(logoDataUri, 'PNG', MARGIN + 2, 12, 14, 14);
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...NAVY);
    doc.text(monogram(COMPANY.name), MARGIN + 9, 21.5, { align: 'center' });
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(255, 255, 255);
  doc.text(COMPANY.name, MARGIN + 24, 19.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...HEADER_TEXT_TINT);
  doc.text(COMPANY.tagline, MARGIN + 24, 25.5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(19);
  doc.setTextColor(255, 255, 255);
  doc.text(title, PAGE_WIDTH - MARGIN, 22, { align: 'right' });
}

// The light strip under the header: a row of small-caps labels with a bold
// value under each. columns: [{ label, value, x }]. Returns nothing -- the
// strip is a fixed height (y 36-52), so callers draw any badge into it
// themselves with drawBadge.
export function drawMetaStrip(doc, columns) {
  doc.setFillColor(...CANVAS);
  doc.rect(0, 36, PAGE_WIDTH, 16, 'F');
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.3);
  doc.line(0, 52, PAGE_WIDTH, 52);

  for (const { label, value, x } of columns) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...GRAY);
    doc.text(label, x, 42);

    if (value) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(...INK);
      doc.text(value, x, 49);
    }
  }
}

// A filled pill with white text, sized to its label -- the PDF equivalent of
// StatusBadge.jsx. (x, y) is the pill's top-left corner.
export function drawBadge(doc, label, color, x, y) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  const badgeWidth = doc.getTextWidth(label) + 8;
  doc.setFillColor(...color);
  doc.roundedRect(x, y, badgeWidth, 6.5, 1.5, 1.5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.text(label, x + badgeWidth / 2, y + 4.4, { align: 'center' });
}

// Renders one "FROM"/"BILL TO" style panel (a label, a bold name, then
// whichever contact lines are actually present -- never a blank line for a
// field nobody filled in) and returns the y position just past its last line,
// so the caller can tell how tall each of the two side-by-side panels ended
// up and start the items table below whichever one ran longer.
export function drawPartyPanel(doc, { label, name, lines }, x) {
  let y = 62;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...GRAY);
  doc.text(label, x, y);
  y += 5.5;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  doc.text(name, x, y);
  y += 5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...GRAY);
  for (const line of lines) {
    doc.text(line, x, y);
    y += 4.6;
  }
  return y;
}

export function buildCustomerLines(doc, customer) {
  const lines = [];
  if (customer?.full_name) lines.push(customer.full_name);
  if (customer?.company_name && customer?.email) lines.push(customer.email);
  if (customer?.phone) lines.push(customer.phone);
  if (customer?.vat_number) lines.push(`VAT No: ${customer.vat_number}`);
  if (customer?.address) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.splitTextToSize(customer.address, 80).forEach((line) => lines.push(line));
  }
  return lines;
}

export function buildCompanyLines() {
  const lines = [];
  if (COMPANY.address) lines.push(COMPANY.address);
  if (COMPANY.phone) lines.push(COMPANY.phone);
  if (COMPANY.email) lines.push(COMPANY.email);
  if (COMPANY.website) lines.push(COMPANY.website);
  if (COMPANY.vatNumber) lines.push(`VAT No: ${COMPANY.vatNumber}`);
  return lines;
}

// Small running header for page 2+ of a long items table, since the full
// branded header is only drawn on page 1.
export function drawContinuationHeader(doc, text) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.text(text, MARGIN, 12);
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, 15, PAGE_WIDTH - MARGIN, 15);
}

export function drawFooter(doc, pageNumber, totalPages) {
  const pageHeight = doc.internal.pageSize.getHeight();
  const footerY = pageHeight - 18;

  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, footerY, PAGE_WIDTH - MARGIN, footerY);

  const contactParts = [COMPANY.phone, COMPANY.email, COMPANY.website].filter(Boolean);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  doc.text(contactParts.length ? `${COMPANY.name} · ${contactParts.join(' · ')}` : COMPANY.name, MARGIN, footerY + 5);
  doc.text(`Generated ${formatDocDate(new Date().toISOString())} via the Tyrotec Customer Portal.`, MARGIN, footerY + 9.5);
  doc.text(`Page ${pageNumber} of ${totalPages}`, PAGE_WIDTH - MARGIN, footerY + 9.5, { align: 'right' });
}

export function drawFooters(doc) {
  const totalPages = doc.internal.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    drawFooter(doc, page, totalPages);
  }
}

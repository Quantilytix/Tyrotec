import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatCurrency } from './formatters';

// Same layout as the backend's own quote-PDF generator
// (backend/src/services/quotePdfService.js -- keep the two in sync), adapted
// to run client-side and trigger a browser download instead of returning a
// Buffer. This version can also PDF an unsaved cart (no quoteNumber yet),
// unlike the backend one which is always for an already-saved quote.
//
// Colors below are lifted straight from this app's own design tokens
// (src/index.css's @theme block) rather than picked fresh, so a downloaded
// quote actually looks like it came from the portal the customer is logged
// into -- ink/navy/canvas/good/bad/amber are that file's exact hex values
// converted to RGB triples, not a separate palette invented here.

// Seller details shown in the document's "FROM" panel and footer. Only
// `name` and `tagline` are known for sure right now -- the rest render as
// blank lines (nothing fabricated) until real values are filled in here, at
// which point they show up automatically on every quote. bankDetails is a
// plain array of lines (e.g. bank name, account number, branch code) printed
// under Terms so a customer paying by EFT has somewhere to copy them from.
const COMPANY = {
  name: 'Tyrotech',
  tagline: 'Supplier for industrial parts and supplies',
  address: '',
  phone: '',
  email: '',
  website: '',
  vatNumber: '',
  bankDetails: [],
};

const INK = [16, 25, 43]; // --color-ink
const NAVY = [30, 58, 102]; // --color-teal-500 (the portal's primary action color)
const NAVY_TINT = [234, 240, 251]; // --color-teal-50
const CANVAS = [245, 246, 248]; // --color-canvas
const GOOD = [21, 128, 61]; // --color-good-500
const AMBER = [217, 119, 6]; // tailwind amber-600, matches StatusBadge's amber quote-status color
const GRAY = [100, 116, 139]; // tailwind slate-500, the portal's secondary-text color
const BORDER = [226, 232, 240]; // tailwind slate-200, the portal's card-border color
const HEADER_TEXT_TINT = [203, 213, 225]; // tailwind slate-300, same as the sidebar's own text-on-ink color
const ACCENT_YELLOW = [250, 204, 21]; // tailwind yellow-400, the portal's active-nav/cart-badge accent

// Matches StatusBadge.jsx's own STYLES for quote statuses exactly (amber for
// submitted, good/green for converted, slate for expired) so the color means
// the same thing here as it does in the portal UI.
const STATUS_COLORS = {
  submitted: AMBER,
  converted: GOOD,
  expired: GRAY,
};

const MARGIN = 14;
const PAGE_WIDTH = 210;

// Document date is issue-date only -- unlike formatters.js's formatDate
// (used for timestamped activity/notification lists), a quotation's header
// shouldn't show a time-of-day next to "Date Issued".
function formatDocDate(isoString) {
  return new Date(isoString).toLocaleDateString('en-ZA', { year: 'numeric', month: 'short', day: 'numeric' });
}

// "Tyrotech" -> "TT": pulls the capitals out of the brand name for a simple
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
function getLogoDataUri() {
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

function drawHeader(doc, logoDataUri) {
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
  doc.text('QUOTATION', PAGE_WIDTH - MARGIN, 22, { align: 'right' });
}

function drawMetaStrip(doc, { quoteNumber, createdAt, status }) {
  doc.setFillColor(...CANVAS);
  doc.rect(0, 36, PAGE_WIDTH, 16, 'F');
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.3);
  doc.line(0, 52, PAGE_WIDTH, 52);

  const columns = [MARGIN, MARGIN + 62, MARGIN + 124];

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...GRAY);
  doc.text('QUOTE NUMBER', columns[0], 42);
  doc.text('DATE ISSUED', columns[1], 42);
  if (status) doc.text('STATUS', columns[2], 42);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(...INK);
  doc.text(quoteNumber ? `#${quoteNumber}` : 'Draft', columns[0], 49);
  doc.text(formatDocDate(createdAt || new Date().toISOString()), columns[1], 49);

  if (status) {
    const label = status.charAt(0).toUpperCase() + status.slice(1);
    const color = STATUS_COLORS[status] || STATUS_COLORS.expired;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    const textWidth = doc.getTextWidth(label);
    const badgeWidth = textWidth + 8;
    doc.setFillColor(...color);
    doc.roundedRect(columns[2], 43.5, badgeWidth, 6.5, 1.5, 1.5, 'F');
    doc.setTextColor(255, 255, 255);
    doc.text(label, columns[2] + badgeWidth / 2, 47.9, { align: 'center' });
  }
}

// Renders one "FROM"/"BILL TO" style panel (a label, a bold name, then
// whichever contact lines are actually present -- never a blank line for a
// field nobody filled in) and returns the y position just past its last line,
// so the caller can tell how tall each of the two side-by-side panels ended
// up and start the items table below whichever one ran longer.
function drawPartyPanel(doc, { label, name, lines }, x) {
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

function buildCustomerLines(doc, customer) {
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

function buildCompanyLines() {
  const lines = [];
  if (COMPANY.address) lines.push(COMPANY.address);
  if (COMPANY.phone) lines.push(COMPANY.phone);
  if (COMPANY.email) lines.push(COMPANY.email);
  if (COMPANY.website) lines.push(COMPANY.website);
  if (COMPANY.vatNumber) lines.push(`VAT No: ${COMPANY.vatNumber}`);
  return lines;
}

function drawTotalsBox(doc, x, y, totalAmount) {
  const width = 80;
  const height = 26;
  doc.setFillColor(...NAVY_TINT);
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.4);
  doc.roundedRect(x, y, width, height, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...GRAY);
  doc.text('TOTAL DUE (INCL. VAT)', x + 6, y + 8);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...NAVY);
  doc.text(formatCurrency(totalAmount), x + 6, y + 18);

  return y + height;
}

function drawTerms(doc, x, y) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...GRAY);
  doc.text('TERMS', x, y);
  y += 5;

  const notes = [
    'This quotation is valid for 14 days from the date issued.',
    'All prices include VAT unless otherwise stated.',
    'Please quote the number above when confirming or paying.',
  ];
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...GRAY);
  for (const note of notes) {
    doc.text(note, x, y);
    y += 4.5;
  }

  if (COMPANY.bankDetails.length > 0) {
    y += 1.5;
    doc.setFont('helvetica', 'bold');
    doc.text('Banking details', x, y);
    y += 4.5;
    doc.setFont('helvetica', 'normal');
    for (const line of COMPANY.bankDetails) {
      doc.text(line, x, y);
      y += 4.5;
    }
  }

  return y;
}

function drawFooter(doc, pageNumber, totalPages) {
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
  doc.text(`Generated ${formatDocDate(new Date().toISOString())} via the Tyrotech Customer Portal.`, MARGIN, footerY + 9.5);
  doc.text(`Page ${pageNumber} of ${totalPages}`, PAGE_WIDTH - MARGIN, footerY + 9.5, { align: 'right' });
}

export async function downloadQuotePdf({ items, totalAmount, customer, quoteNumber, status, createdAt }) {
  const logoDataUri = await getLogoDataUri();
  // compress: true flate-compresses PDF streams, including the embedded
  // logo -- without it jsPDF stores the logo as raw uncompressed RGBA pixel
  // data, ballooning an ~2KB PNG into a >100KB stream despite the source
  // image being almost entirely flat white.
  const doc = new jsPDF({ compress: true });

  drawHeader(doc, logoDataUri);
  drawMetaStrip(doc, { quoteNumber, createdAt, status });

  const leftPanelY = drawPartyPanel(
    doc,
    { label: 'FROM', name: COMPANY.name, lines: buildCompanyLines() },
    MARGIN
  );
  const rightPanelY = drawPartyPanel(
    doc,
    { label: 'BILL TO', name: customer?.company_name || customer?.email || 'Customer', lines: buildCustomerLines(doc, customer) },
    MARGIN + 95
  );

  autoTable(doc, {
    startY: Math.max(leftPanelY, rightPanelY) + 6,
    head: [['Product', 'SKU', 'Unit Price', 'Qty', 'Subtotal']],
    body: items.map((item) => [
      item.name,
      item.sku,
      formatCurrency(item.unit_price),
      String(item.quantity),
      formatCurrency(item.unit_price * item.quantity),
    ]),
    margin: { left: MARGIN, right: MARGIN, bottom: 26 },
    headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', fontSize: 9 },
    styles: { fontSize: 9, textColor: INK, lineColor: BORDER, lineWidth: 0.15, cellPadding: 3 },
    alternateRowStyles: { fillColor: CANVAS },
    columnStyles: {
      0: { halign: 'left' },
      1: { halign: 'left' },
      2: { halign: 'right' },
      3: { halign: 'right', cellWidth: 16 },
      4: { halign: 'right' },
    },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...INK);
        doc.text(
          `${COMPANY.name} — Quotation ${quoteNumber ? `#${quoteNumber}` : ''} (continued)`,
          MARGIN,
          12
        );
        doc.setDrawColor(...BORDER);
        doc.setLineWidth(0.3);
        doc.line(MARGIN, 15, PAGE_WIDTH - MARGIN, 15);
      }
    },
  });

  const pageHeight = doc.internal.pageSize.getHeight();
  let finalY = doc.lastAutoTable.finalY;
  if (finalY + 45 > pageHeight - 26) {
    doc.addPage();
    finalY = 14;
  }

  const blockY = finalY + 8;
  drawTerms(doc, MARGIN, blockY);
  drawTotalsBox(doc, PAGE_WIDTH - MARGIN - 80, blockY - 6, totalAmount);

  const totalPages = doc.internal.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);
    drawFooter(doc, page, totalPages);
  }

  doc.save(`quote-${quoteNumber || Date.now()}.pdf`);
}

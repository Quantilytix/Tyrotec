import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatCurrency } from './formatters';
import { documentTotals, lineTotals, vatRateLabel } from './vat';
import {
  COMPANY,
  INK,
  NAVY,
  NAVY_TINT,
  CANVAS,
  GOOD,
  AMBER,
  GRAY,
  BORDER,
  MARGIN,
  PAGE_WIDTH,
  FOOTER_CLEARANCE,
  formatDocDate,
  getLogoDataUri,
  drawHeader,
  drawMetaStrip,
  drawBadge,
  drawPartyPanel,
  buildCustomerLines,
  buildCompanyLines,
  drawContinuationHeader,
  drawFooters,
} from './pdfShared';

// Same layout as the backend's own quote-PDF generator
// (backend/src/services/quotePdfService.js -- keep the two in sync), adapted
// to run client-side and trigger a browser download instead of returning a
// Buffer. This version can also PDF an unsaved cart (no quoteNumber yet),
// unlike the backend one which is always for an already-saved quote.
// Branding, colors, header and footer live in pdfShared.js, shared with the
// receipt PDF.

// Matches StatusBadge.jsx's own STYLES for quote statuses exactly (amber for
// submitted, good/green for converted, slate for expired) so the color means
// the same thing here as it does in the portal UI.
const STATUS_COLORS = {
  submitted: AMBER,
  converted: GOOD,
  expired: GRAY,
};

function drawQuoteMeta(doc, { quoteNumber, createdAt, status }) {
  const columns = [MARGIN, MARGIN + 62, MARGIN + 124];

  drawMetaStrip(doc, [
    { label: 'QUOTE NUMBER', value: quoteNumber ? `#${quoteNumber}` : 'Draft', x: columns[0] },
    { label: 'DATE ISSUED', value: formatDocDate(createdAt || new Date().toISOString()), x: columns[1] },
    ...(status ? [{ label: 'STATUS', x: columns[2] }] : []),
  ]);

  if (status) {
    const label = status.charAt(0).toUpperCase() + status.slice(1);
    drawBadge(doc, label, STATUS_COLORS[status] || STATUS_COLORS.expired, columns[2], 43.5);
  }
}

// Subtotal and VAT above the amount due, because prices are quoted excluding
// VAT: the customer has to be able to see what the VAT portion is, and a
// VAT-registered one needs it to claim the input tax back.
function drawTotalsBox(doc, x, y, totals) {
  const width = 80;
  const height = 40;
  doc.setFillColor(...NAVY_TINT);
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.4);
  doc.roundedRect(x, y, width, height, 2, 2, 'FD');

  const line = (label, value, lineY) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...GRAY);
    doc.text(label, x + 6, lineY);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...INK);
    doc.text(formatCurrency(value), x + width - 6, lineY, { align: 'right' });
  };

  line('Subtotal (excl. VAT)', totals.subtotal_amount, y + 8);
  line('VAT', totals.vat_amount, y + 14.5);

  doc.setDrawColor(...NAVY);
  doc.setLineWidth(0.2);
  doc.line(x + 6, y + 18.5, x + width - 6, y + 18.5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...GRAY);
  doc.text('TOTAL DUE (INCL. VAT)', x + 6, y + 25);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...NAVY);
  doc.text(formatCurrency(totals.total_amount), x + 6, y + 34);

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
    'All prices exclude VAT. VAT is shown per line and in the totals.',
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

// totals: { subtotal_amount, vat_amount, total_amount } from displayTotals()
// (or the cart). Computed from the items when a caller omits it.
export async function downloadQuotePdf({ items, totals, customer, quoteNumber, status, createdAt }) {
  const documentSums = totals || documentTotals(items);
  const logoDataUri = await getLogoDataUri();
  // compress: true flate-compresses PDF streams, including the embedded
  // logo -- without it jsPDF stores the logo as raw uncompressed RGBA pixel
  // data, ballooning an ~2KB PNG into a >100KB stream despite the source
  // image being almost entirely flat white.
  const doc = new jsPDF({ compress: true });

  drawHeader(doc, logoDataUri, 'QUOTATION');
  drawQuoteMeta(doc, { quoteNumber, createdAt, status });

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
    head: [['Product', 'SKU', 'Unit Price', 'Qty', 'VAT', 'Line Total']],
    body: items.map((item) => [
      item.name,
      item.sku,
      formatCurrency(item.unit_price),
      String(item.quantity),
      vatRateLabel(item.vat_rate),
      formatCurrency(lineTotals(item).net),
    ]),
    margin: { left: MARGIN, right: MARGIN, bottom: FOOTER_CLEARANCE },
    headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', fontSize: 9 },
    styles: { fontSize: 9, textColor: INK, lineColor: BORDER, lineWidth: 0.15, cellPadding: 3 },
    alternateRowStyles: { fillColor: CANVAS },
    columnStyles: {
      0: { halign: 'left' },
      1: { halign: 'left' },
      2: { halign: 'right' },
      3: { halign: 'right', cellWidth: 14 },
      4: { halign: 'right', cellWidth: 16 },
      5: { halign: 'right' },
    },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) {
        drawContinuationHeader(doc, `${COMPANY.name} — Quotation ${quoteNumber ? `#${quoteNumber}` : ''} (continued)`);
      }
    },
  });

  const pageHeight = doc.internal.pageSize.getHeight();
  let finalY = doc.lastAutoTable.finalY;
  if (finalY + 58 > pageHeight - FOOTER_CLEARANCE) {
    doc.addPage();
    finalY = 14;
  }

  const blockY = finalY + 8;
  drawTerms(doc, MARGIN, blockY);
  drawTotalsBox(doc, PAGE_WIDTH - MARGIN - 80, blockY - 6, documentSums);

  drawFooters(doc);

  doc.save(`quote-${quoteNumber || Date.now()}.pdf`);
}

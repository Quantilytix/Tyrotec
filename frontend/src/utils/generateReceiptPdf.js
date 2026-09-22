import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatCurrency } from './formatters';
import { displayTotals, lineTotals, vatRateLabel } from './vat';
import {
  COMPANY,
  INK,
  NAVY,
  CANVAS,
  GOOD,
  GOOD_TINT,
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

// Proof-of-payment receipt for an order, styled to match the quotation PDF
// (same header, panels, table and footer from pdfShared.js) but laid out the
// way a receipt reads: what was paid, how, when, and that nothing is owed.

// Orders a receipt can be downloaded for: paid via PayFast (confirmed), then
// ready for collection, or finished through the manual flow (completed).
export const RECEIPT_STATUSES = ['confirmed', 'ready_for_collection', 'completed'];

// Kept as an export for callers that still reference it; the rate actually
// charged lives on each document (utils/vat.js).
export const VAT_RATE = 0.15;

// Keep in step with the methods RecordPaymentForm.jsx offers, plus
// 'payfast', which only the gateway webhook ever writes.
const METHOD_LABELS = {
  payfast: 'PayFast (online payment)',
  bank_transfer: 'Bank transfer / EFT',
  cash: 'Cash',
  card_machine: 'Card machine',
  other: 'Other',
};

const ORDER_STATUS_LABELS = {
  confirmed: 'Confirmed',
  ready_for_collection: 'Ready for collection',
  completed: 'Completed',
};

// The approved payment a receipt is issued against, or null when this order
// shouldn't have a receipt yet (wrong status, or no payment approved -- a
// receipt must never be issued for money that hasn't been verified).
export function getReceiptPayment(order) {
  if (!order || !RECEIPT_STATUSES.includes(order.status)) return null;
  const approved = (order.payments || []).filter((p) => p.status === 'approved');
  if (approved.length === 0) return null;
  return approved.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
}

const roundCents = (value) => Math.round(value * 100) / 100;

// The order's own stored figures: prices are quoted excluding VAT and the VAT
// charged is recorded per line, so the receipt states what was actually
// charged instead of re-deriving it. Orders placed before VAT-exclusive
// pricing have no stored breakdown, and displayTotals works theirs back out of
// the inclusive total -- so an old receipt still prints exactly as it did.
export function receiptTotals(order, amountPaid) {
  const { subtotal_amount, vat_amount, total_amount, legacy } = displayTotals(order);
  const paid = Number(amountPaid) || 0;
  return {
    subtotalExclVat: subtotal_amount,
    vat: vat_amount,
    total: total_amount,
    paid,
    balance: Math.max(0, roundCents(total_amount - paid)),
    legacy,
  };
}

export function receiptNumber(orderNumber) {
  return `RCT-${String(orderNumber).padStart(5, '0')}`;
}

function paymentDate(payment) {
  return payment.verified_at || payment.reviewed_at || payment.created_at;
}

function drawReceiptMeta(doc, { order, payment, totals }) {
  const columns = [MARGIN, MARGIN + 46, MARGIN + 92, MARGIN + 138];

  drawMetaStrip(doc, [
    { label: 'RECEIPT NUMBER', value: receiptNumber(order.order_number), x: columns[0] },
    { label: 'DATE PAID', value: formatDocDate(paymentDate(payment)), x: columns[1] },
    { label: 'ORDER NUMBER', value: `#${order.order_number}`, x: columns[2] },
    { label: 'PAYMENT STATUS', x: columns[3] },
  ]);

  const fullyPaid = totals.balance === 0;
  drawBadge(doc, fullyPaid ? 'Paid in full' : 'Part paid', fullyPaid ? GOOD : AMBER, columns[3], 43.5);
}

// Label on the left, value on the left at a fixed indent -- the "Payment
// method: PayFast" rows under PAYMENT DETAILS.
function drawDetailRows(doc, rows, x, y) {
  for (const [label, value] of rows) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...GRAY);
    doc.text(label, x, y);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...INK);
    const valueLines = doc.splitTextToSize(String(value), 58);
    doc.text(valueLines, x + 32, y);
    y += 5.5 * valueLines.length;
  }
  return y;
}

// Label on the left, amount right-aligned -- the classic receipt summary
// column (subtotal, VAT, total, paid, balance).
function drawSummaryRow(doc, label, amount, x, width, y, { bold = false, color = INK } = {}) {
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setFontSize(bold ? 10 : 9);
  doc.setTextColor(...(bold ? INK : GRAY));
  doc.text(label, x, y);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...color);
  doc.text(formatCurrency(amount), x + width, y, { align: 'right' });
}

function drawSummary(doc, totals, x, y) {
  const width = 80;

  drawSummaryRow(doc, 'Subtotal (excl. VAT)', totals.subtotalExclVat, x, width, y);
  y += 6;
  drawSummaryRow(doc, 'VAT', totals.vat, x, width, y);
  y += 3;

  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.3);
  doc.line(x, y, x + width, y);
  y += 5.5;

  drawSummaryRow(doc, 'Total (incl. VAT)', totals.total, x, width, y, { bold: true });
  y += 6;
  drawSummaryRow(doc, 'Amount paid', totals.paid, x, width, y, { color: GOOD });
  y += 5;

  const fullyPaid = totals.balance === 0;
  const accent = fullyPaid ? GOOD : AMBER;
  doc.setFillColor(...(fullyPaid ? GOOD_TINT : [255, 251, 235]));
  doc.setDrawColor(...accent);
  doc.setLineWidth(0.4);
  doc.roundedRect(x, y, width, 14, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...GRAY);
  doc.text('BALANCE DUE', x + 5, y + 8.8);
  doc.setFontSize(14);
  doc.setTextColor(...accent);
  doc.text(formatCurrency(totals.balance), x + width - 5, y + 9.5, { align: 'right' });

  return y + 14;
}

// A tilted rubber-stamp "PAID" mark. jsPDF can rotate text but not shapes,
// so the border is drawn as a closed polygon from the rectangle's corners
// rotated about the stamp's centre by hand.
function drawPaidStamp(doc, cx, cy, dateText) {
  const angle = 8; // degrees, counter-clockwise
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Visual counter-clockwise rotation in jsPDF's y-down page coordinates.
  const rotate = (x, y) => [cx + x * cos + y * sin, cy - x * sin + y * cos];

  const drawBorder = (halfW, halfH, lineWidth) => {
    const corners = [
      rotate(-halfW, -halfH),
      rotate(halfW, -halfH),
      rotate(halfW, halfH),
      rotate(-halfW, halfH),
    ];
    const segments = corners.slice(1).map(([px, py], i) => [px - corners[i][0], py - corners[i][1]]);
    doc.setLineWidth(lineWidth);
    doc.lines(segments, corners[0][0], corners[0][1], [1, 1], 'S', true);
  };

  doc.setDrawColor(...GOOD);
  drawBorder(24, 10, 0.9);
  drawBorder(22.5, 8.5, 0.3);

  // Text is anchored at its baseline-left, so walk back from the centre by
  // half the width along the text direction and down by half the cap height
  // perpendicular to it.
  const placeCentered = (text, fontSize, offsetDown) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(fontSize);
    const halfWidth = doc.getTextWidth(text) / 2;
    const halfCap = (fontSize * 0.3528 * 0.72) / 2;
    const down = offsetDown + halfCap;
    const ox = cx - halfWidth * cos + down * sin;
    const oy = cy + halfWidth * sin + down * cos;
    doc.text(text, ox, oy, { angle });
  };

  doc.setTextColor(...GOOD);
  placeCentered('PAID', 22, -2);
  placeCentered(dateText.toUpperCase(), 7.5, 5.2);
}

export function buildReceiptDoc({ order, payment, logoDataUri }) {
  // compress: true -- same reasoning as the quotation PDF: keeps the
  // embedded logo from ballooning into a raw pixel stream.
  const doc = new jsPDF({ compress: true });
  const customer = order.users || {};
  const totals = receiptTotals(order, payment.amount);

  drawHeader(doc, logoDataUri, 'RECEIPT');
  drawReceiptMeta(doc, { order, payment, totals });

  const leftPanelY = drawPartyPanel(
    doc,
    { label: 'FROM', name: COMPANY.name, lines: buildCompanyLines() },
    MARGIN
  );
  const rightPanelY = drawPartyPanel(
    doc,
    { label: 'RECEIVED FROM', name: customer.company_name || customer.email || 'Customer', lines: buildCustomerLines(doc, customer) },
    MARGIN + 95
  );

  autoTable(doc, {
    startY: Math.max(leftPanelY, rightPanelY) + 6,
    head: [['Description', 'SKU', 'Qty', 'Unit Price', 'VAT', 'Amount']],
    body: (order.order_items || []).map((item) => [
      item.products?.name || 'Item',
      item.products?.sku || '',
      String(item.quantity),
      formatCurrency(item.unit_price),
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
      2: { halign: 'right', cellWidth: 14 },
      3: { halign: 'right' },
      4: { halign: 'right', cellWidth: 16 },
      5: { halign: 'right' },
    },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) {
        drawContinuationHeader(doc, `${COMPANY.name} — Receipt ${receiptNumber(order.order_number)} (continued)`);
      }
    },
  });

  // The payment details, summary, stamp and notes block is ~85mm tall; keep
  // it together on one page rather than splitting the totals from the stamp.
  const pageHeight = doc.internal.pageSize.getHeight();
  let finalY = doc.lastAutoTable.finalY;
  if (finalY + 88 > pageHeight - FOOTER_CLEARANCE) {
    doc.addPage();
    finalY = 14;
  }
  const blockY = finalY + 10;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...GRAY);
  doc.text('PAYMENT DETAILS', MARGIN, blockY);

  const detailsEndY = drawDetailRows(
    doc,
    [
      ['Payment method', METHOD_LABELS[payment.method] || payment.method || 'Payment'],
      ['Reference', payment.gateway_reference || payment.reference || '—'],
      ['Date paid', formatDocDate(paymentDate(payment))],
      ['Order status', ORDER_STATUS_LABELS[order.status] || order.status],
    ],
    MARGIN,
    blockY + 6
  );

  const summaryEndY = drawSummary(doc, totals, PAGE_WIDTH - MARGIN - 80, blockY + 1);

  if (totals.balance === 0) {
    drawPaidStamp(doc, MARGIN + 34, detailsEndY + 12, formatDocDate(paymentDate(payment)));
  }

  // The tilted stamp reaches ~26mm below the detail rows; clear it.
  const notesY = Math.max(detailsEndY + (totals.balance === 0 ? 35 : 8), summaryEndY + 10);
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, notesY - 5, PAGE_WIDTH - MARGIN, notesY - 5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  doc.text('Thank you for your business.', MARGIN, notesY + 1);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...GRAY);
  const notes = [
    'This receipt confirms payment for the order above. Prices exclude VAT; VAT is shown per line.',
    order.status === 'completed'
      ? 'Please keep it for your records.'
      : 'Please keep it for your records and present it when collecting your order.',
  ];
  notes.forEach((note, i) => doc.text(note, MARGIN, notesY + 6.5 + i * 4.5));

  drawFooters(doc);
  return doc;
}

export async function downloadReceiptPdf(order) {
  const payment = getReceiptPayment(order);
  if (!payment) throw new Error('This order does not have a receipt yet.');
  const logoDataUri = await getLogoDataUri();
  const doc = buildReceiptDoc({ order, payment, logoDataUri });
  doc.save(`receipt-${receiptNumber(order.order_number)}.pdf`);
}

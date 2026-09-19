const { Readable } = require('stream');
const ExcelJS = require('exceljs');
const asyncHandler = require('../utils/asyncHandler');
const { extractFromReceipt, extractFromSpreadsheet } = require('../services/geminiImportService');
const { matchExtractedRows, confirmProductImport } = require('../services/productImportService');
const { listCategoryNames } = require('../services/categoryService');

const SPREADSHEET_MIMETYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'text/csv',
];

// Reads whichever sheet has data into a plain array-of-arrays -- exceljs
// row.values is 1-indexed with a leading empty slot, hence the slice(1).
async function parseSpreadsheetBuffer(buffer, mimeType) {
  const workbook = new ExcelJS.Workbook();

  if (mimeType === 'text/csv') {
    await workbook.csv.read(Readable.from(buffer));
  } else {
    await workbook.xlsx.load(buffer);
  }

  const worksheet = workbook.worksheets[0];
  const rows = [];
  worksheet.eachRow((row) => {
    rows.push(row.values.slice(1).map((v) => (v === null || v === undefined ? '' : String(v))));
  });
  return rows;
}

// Admin/sales_rep only. Reads the uploaded receipt/spreadsheet, asks Gemini
// to extract product line items, attaches a best-guess existing-product
// match for each, and returns the annotated rows -- nothing is written to
// the database here, this only powers the review screen.
const extractProductImport = asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  // The live category list is handed to the extractor so it labels rows with
  // the categories this business actually uses, instead of inventing its own.
  const categories = await listCategoryNames();

  let rows;
  try {
    if (SPREADSHEET_MIMETYPES.includes(req.file.mimetype)) {
      const parsedRows = await parseSpreadsheetBuffer(req.file.buffer, req.file.mimetype);
      rows = await extractFromSpreadsheet(parsedRows, categories);
    } else {
      rows = await extractFromReceipt(req.file.buffer, req.file.mimetype, categories);
    }
  } catch (err) {
    return res.status(422).json({ error: err.message || "Couldn't read that file." });
  }

  if (!rows.length) {
    return res.status(422).json({ error: "Couldn't find any product line items in that file." });
  }

  const matched = await matchExtractedRows(rows);
  return res.json({ rows: matched });
});

// Admin/sales_rep only. Takes the admin-reviewed row list and commits it.
const confirmImport = asyncHandler(async (req, res) => {
  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'No rows to import' });
  }

  const result = await confirmProductImport(rows);
  return res.json(result);
});

module.exports = { extractProductImport, confirmImport };

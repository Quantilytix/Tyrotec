// Turns a supplier receipt (image/PDF) or a parsed spreadsheet into a
// normalized list of product line items, using Gemini's structured-output
// mode (responseSchema) rather than parsing free text out of a chat reply --
// the model is constrained to return exactly this shape or the call fails
// cleanly, instead of us having to guess at loosely-formatted JSON.

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent';

const ROW_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      name: { type: 'STRING' },
      sku: { type: 'STRING', nullable: true },
      category: { type: 'STRING', nullable: true },
      unit_price: { type: 'NUMBER' },
      quantity: { type: 'INTEGER' },
      description: { type: 'STRING', nullable: true },
    },
    required: ['name', 'unit_price', 'quantity'],
  },
};

async function callGemini(parts) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }

  const res = await fetch(`${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: ROW_SCHEMA,
      },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || 'Gemini request failed');
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no extractable content.');

  let rows;
  try {
    rows = JSON.parse(text);
  } catch {
    throw new Error('Gemini returned malformed data. Try a clearer file.');
  }
  if (!Array.isArray(rows)) throw new Error('Gemini returned an unexpected shape.');

  return rows;
}

// The category line of both prompts. Categories are the staff-managed list
// (categoryService.js), not a fixed set baked in here -- they add and remove
// their own, so the live list is passed in on every call. Anything the model
// returns is still checked against the list by matchCategory below; the
// instruction just improves the hit rate.
function categoryInstruction(categories) {
  if (!categories || categories.length === 0) {
    return '- category: always null (this business has no category list configured)';
  }
  return `- category: EXACTLY one of these existing categories, copied verbatim, or null if none of them clearly fit. Never invent a category that is not on this list:
${categories.map((name) => `  * ${name}`).join('\n')}`;
}

function receiptPrompt(categories) {
  return `You are extracting purchased product line items from a supplier receipt, invoice, or packing slip (image or PDF).

For each distinct product line, extract:
- name: a clear, human-readable product name
- sku: the item's SKU/code/part number if shown on the document, otherwise null
${categoryInstruction(categories)}
- unit_price: the price paid per unit, as a plain number with no currency symbol
- quantity: the number of units purchased on that line
- description: any other useful descriptive detail from the line, otherwise null

Ignore subtotals, tax lines, shipping/delivery charges, discounts, and anything that isn't an actual purchased product. Return only the extracted line items.`;
}

function spreadsheetPrompt(categories) {
  return `You are given rows from a spreadsheet listing products a business purchased or wants to add to their stock catalog. Column headers may be inconsistent, abbreviated, or missing.

Map each row to:
- name: a clear, human-readable product name
- sku: the item's SKU/code/part number if present, otherwise null
${categoryInstruction(categories)}
- unit_price: the price per unit, as a plain number with no currency symbol
- quantity: the number of units (default to 1 if the sheet has no quantity column)
- description: any other useful descriptive detail, otherwise null

Skip rows that clearly aren't product line items (blank rows, header repeats, totals). Return only the extracted line items.

Spreadsheet data:
`;
}

// Maps whatever the model (or a spreadsheet column) produced onto the real
// category list, case-insensitively, and returns the stored spelling. Anything
// unrecognised becomes null rather than a new invented category -- the review
// screen then shows an empty dropdown for staff to pick from.
function matchCategory(value, categories) {
  const wanted = String(value || '').trim().toLowerCase();
  if (!wanted) return null;
  return (categories || []).find((name) => name.toLowerCase() === wanted) || null;
}

function applyCategories(rows, categories) {
  return rows.map((row) => ({ ...row, category: matchCategory(row.category, categories) }));
}

// A supplier inventory export is already structured data -- asking an LLM to
// turn hundreds of its rows back into JSON is slower, costs money, and can
// exceed the model's response limit (leaving us with truncated, malformed
// JSON). Recognise common column headings and read those files directly.
// Gemini remains the fallback for genuinely unstructured spreadsheets.
function normaliseHeader(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findColumn(headers, names) {
  return headers.findIndex((header) => names.includes(header));
}

function parseNumber(value) {
  const cleaned = String(value ?? '')
    .replace(/[^0-9,.-]/g, '')
    .replace(/,/g, '');
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function extractStructuredSpreadsheet(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return null;

  const headers = rows[0].map(normaliseHeader);
  const nameIndex = findColumn(headers, ['name', 'product name', 'product', 'item', 'item description', 'sales description']);
  const skuIndex = findColumn(headers, ['sku', 'product sku', 'item code', 'item number', 'product code', 'code']);
  const priceIndex = findColumn(headers, ['unit price', 'sales price', 'sales price rate', 'price', 'rate', 'selling price']);
  const quantityIndex = findColumn(headers, ['quantity', 'qty', 'stock quantity', 'on hand', 'stock on hand']);
  const categoryIndex = findColumn(headers, ['category', 'product category']);

  // A name and price are the minimum unambiguous fields needed to create a
  // usable product. Without them, hand the sheet to Gemini as before.
  if (nameIndex < 0 || priceIndex < 0) return null;

  const items = rows.slice(1).flatMap((row) => {
    const name = String(row[nameIndex] || '').trim();
    const unitPrice = parseNumber(row[priceIndex]);
    if (!name || unitPrice === null) return [];

    const parsedQuantity = quantityIndex >= 0 ? parseNumber(row[quantityIndex]) : null;
    return [{
      name,
      sku: skuIndex >= 0 ? String(row[skuIndex] || '').trim() || null : null,
      category: categoryIndex >= 0 ? String(row[categoryIndex] || '').trim() || null : null,
      unit_price: unitPrice,
      quantity: Number.isInteger(parsedQuantity) && parsedQuantity > 0 ? parsedQuantity : 1,
      description: null,
    }];
  });

  return items;
}

// buffer: the raw file bytes (image or PDF), mimeType: e.g. 'image/jpeg',
// 'application/pdf'. categories: the current managed category list.
async function extractFromReceipt(buffer, mimeType, categories = []) {
  const rows = await callGemini([
    { text: receiptPrompt(categories) },
    { inline_data: { mime_type: mimeType, data: buffer.toString('base64') } },
  ]);
  return applyCategories(rows, categories);
}

// rows: array of arrays (or objects) already parsed out of the spreadsheet by exceljs --
// serialized as simple tab-separated text so Gemini can read arbitrary/inconsistent headers.
async function extractFromSpreadsheet(rows, categories = []) {
  const structuredRows = extractStructuredSpreadsheet(rows);
  if (structuredRows) return applyCategories(structuredRows, categories);

  const text = rows.map((row) => row.join('\t')).join('\n');
  return applyCategories(await callGemini([{ text: spreadsheetPrompt(categories) + text }]), categories);
}

module.exports = {
  extractFromReceipt,
  extractFromSpreadsheet,
  extractStructuredSpreadsheet,
  matchCategory,
  categoryInstruction,
};

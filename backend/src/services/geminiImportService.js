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

const RECEIPT_PROMPT = `You are extracting purchased product line items from a supplier receipt, invoice, or packing slip (image or PDF).

For each distinct product line, extract:
- name: a clear, human-readable product name
- sku: the item's SKU/code/part number if shown on the document, otherwise null
- category: a short, lowercase, single-word-ish category guess if reasonably inferable (e.g. "fasteners", "electrical"), otherwise null
- unit_price: the price paid per unit, as a plain number with no currency symbol
- quantity: the number of units purchased on that line
- description: any other useful descriptive detail from the line, otherwise null

Ignore subtotals, tax lines, shipping/delivery charges, discounts, and anything that isn't an actual purchased product. Return only the extracted line items.`;

const SPREADSHEET_PROMPT = `You are given rows from a spreadsheet listing products a business purchased or wants to add to their stock catalog. Column headers may be inconsistent, abbreviated, or missing.

Map each row to:
- name: a clear, human-readable product name
- sku: the item's SKU/code/part number if present, otherwise null
- category: a short, lowercase, single-word-ish category guess if reasonably inferable, otherwise null
- unit_price: the price per unit, as a plain number with no currency symbol
- quantity: the number of units (default to 1 if the sheet has no quantity column)
- description: any other useful descriptive detail, otherwise null

Skip rows that clearly aren't product line items (blank rows, header repeats, totals). Return only the extracted line items.

Spreadsheet data:
`;

// buffer: the raw file bytes (image or PDF), mimeType: e.g. 'image/jpeg', 'application/pdf'.
function extractFromReceipt(buffer, mimeType) {
  return callGemini([
    { text: RECEIPT_PROMPT },
    { inline_data: { mime_type: mimeType, data: buffer.toString('base64') } },
  ]);
}

// rows: array of arrays (or objects) already parsed out of the spreadsheet by exceljs --
// serialized as simple tab-separated text so Gemini can read arbitrary/inconsistent headers.
function extractFromSpreadsheet(rows) {
  const text = rows.map((row) => row.join('\t')).join('\n');
  return callGemini([{ text: SPREADSHEET_PROMPT + text }]);
}

module.exports = { extractFromReceipt, extractFromSpreadsheet };

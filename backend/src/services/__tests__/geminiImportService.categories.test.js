const { matchCategory, categoryInstruction, extractStructuredSpreadsheet } = require('../geminiImportService');

const CATEGORIES = ['Diesel Engines', 'Hydraulic pumps', 'Filters'];

describe('matchCategory', () => {
  it('returns the stored spelling for a case-insensitive match', () => {
    expect(matchCategory('filters', CATEGORIES)).toBe('Filters');
    expect(matchCategory('  HYDRAULIC PUMPS ', CATEGORIES)).toBe('Hydraulic pumps');
  });

  // The whole point: a model guess like "engines" must not become a brand new
  // category. Left blank, staff pick from the dropdown on the review screen.
  it('returns null for anything not on the list, rather than inventing one', () => {
    expect(matchCategory('engines', CATEGORIES)).toBeNull();
    expect(matchCategory('', CATEGORIES)).toBeNull();
    expect(matchCategory(null, CATEGORIES)).toBeNull();
    expect(matchCategory('Filters', [])).toBeNull();
  });
});

describe('categoryInstruction', () => {
  it('lists every category the business currently has', () => {
    const instruction = categoryInstruction(CATEGORIES);
    for (const name of CATEGORIES) expect(instruction).toContain(name);
    expect(instruction).toContain('Never invent a category');
  });

  it('tells the model to use null when no categories are configured', () => {
    expect(categoryInstruction([])).toContain('always null');
  });
});

describe('extractStructuredSpreadsheet', () => {
  // The direct spreadsheet reader keeps the sheet's own spelling; the caller
  // (extractFromSpreadsheet) is what maps it onto the category list.
  it('keeps the category column as written, without lowercasing it', () => {
    const rows = [
      ['Name', 'SKU', 'Price', 'Qty', 'Category'],
      ['Filter element', 'FE-1', '120.50', '4', 'Filters'],
    ];
    expect(extractStructuredSpreadsheet(rows)[0]).toMatchObject({
      name: 'Filter element',
      sku: 'FE-1',
      unit_price: 120.5,
      quantity: 4,
      category: 'Filters',
    });
  });
});

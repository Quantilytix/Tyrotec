const mockFrom = jest.fn();
jest.mock('../../config/supabase', () => ({ from: mockFrom }));

const categoryService = require('../categoryService');

// supabase.from('product_categories') is used three ways here:
//   .select(...).order(...)                  -> list
//   .insert([...]).select(...).single()      -> create
//   .delete({ count }).eq(...)               -> delete
function mockList(names) {
  mockFrom.mockImplementation(() => ({
    select: () => ({
      order: () => Promise.resolve({
        data: names.map((name, i) => ({ id: `id-${i}`, name })),
        error: null,
      }),
    }),
  }));
}

describe('categoryService', () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  describe('createCategory', () => {
    const mockInsert = (result) => {
      mockFrom.mockImplementation(() => ({
        insert: () => ({ select: () => ({ single: () => Promise.resolve(result) }) }),
      }));
    };

    it('trims the name before saving', async () => {
      let saved;
      mockFrom.mockImplementation(() => ({
        insert: (rows) => {
          saved = rows[0];
          return { select: () => ({ single: () => Promise.resolve({ data: { id: '1', name: saved.name }, error: null }) }) };
        },
      }));

      const result = await categoryService.createCategory('  Drive Train  ');
      expect(saved.name).toBe('Drive Train');
      expect(result.category.name).toBe('Drive Train');
    });

    it('rejects a blank name without hitting the database', async () => {
      const result = await categoryService.createCategory('   ');
      expect(result).toEqual({ error: 'A category name is required.', status: 400 });
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it('turns a unique-violation into a readable 409', async () => {
      mockInsert({ data: null, error: { code: '23505', message: 'duplicate key value' } });
      const result = await categoryService.createCategory('Filters');
      expect(result).toEqual({ error: '"Filters" is already a category.', status: 409 });
    });

    it('rethrows unexpected database errors', async () => {
      mockInsert({ data: null, error: { code: '42P01', message: 'relation does not exist' } });
      await expect(categoryService.createCategory('Filters')).rejects.toMatchObject({ code: '42P01' });
    });
  });

  describe('isKnownCategory', () => {
    it('matches regardless of capitalisation, like the unique index', async () => {
      mockList(['Filters', 'Rock Drills']);
      expect(await categoryService.isKnownCategory('filters')).toBe(true);
      expect(await categoryService.isKnownCategory('  ROCK DRILLS ')).toBe(true);
      expect(await categoryService.isKnownCategory('Booms')).toBe(false);
      expect(await categoryService.isKnownCategory('')).toBe(false);
    });
  });

  describe('assertCategoryAllowed', () => {
    it('allows a category that is on the list', async () => {
      mockList(['Filters']);
      expect(await categoryService.assertCategoryAllowed('Filters')).toBeNull();
    });

    it('rejects one that is not, with a message naming it', async () => {
      mockList(['Filters']);
      const problem = await categoryService.assertCategoryAllowed('Fliters');
      expect(problem.status).toBe(400);
      expect(problem.error).toContain('"Fliters" is not one of the product categories');
    });

    // Products loaded before the list existed keep off-list categories; editing
    // such a product's price must not force a recategorisation.
    it('allows an off-list category when it is the value already on the product', async () => {
      mockList(['Filters']);
      expect(await categoryService.assertCategoryAllowed('hydraulics', 'hydraulics')).toBeNull();
      expect(await categoryService.assertCategoryAllowed('Hydraulics', ' hydraulics ')).toBeNull();
    });

    it('still rejects changing an off-list category to another off-list one', async () => {
      mockList(['Filters']);
      const problem = await categoryService.assertCategoryAllowed('pumps', 'hydraulics');
      expect(problem.status).toBe(400);
    });

    it('ignores an absent category (partial updates that never mention it)', async () => {
      expect(await categoryService.assertCategoryAllowed(undefined)).toBeNull();
      expect(mockFrom).not.toHaveBeenCalled();
    });
  });
});

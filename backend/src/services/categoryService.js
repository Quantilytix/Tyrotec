// The managed list of product categories (022_product_categories.sql).
//
// products.category remains free text with no foreign key -- see that
// migration for why -- so this list is the set of *choices* offered, and the
// API is what keeps new data inside it. Callers that write a product category
// go through assertCategoryAllowed below.

const supabase = require('../config/supabase');

function normalise(name) {
  return String(name || '').trim();
}

async function listCategories() {
  const { data, error } = await supabase
    .from('product_categories')
    .select('id, name')
    .order('name', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function listCategoryNames() {
  return (await listCategories()).map((category) => category.name);
}

async function createCategory(rawName) {
  const name = normalise(rawName);
  if (!name) return { error: 'A category name is required.', status: 400 };
  if (name.length > 100) return { error: 'Category names are limited to 100 characters.', status: 400 };

  const { data, error } = await supabase
    .from('product_categories')
    .insert([{ name }])
    .select('id, name')
    .single();

  if (error) {
    // 23505 = unique violation on lower(name): the category already exists,
    // possibly spelled with different capitalisation.
    if (error.code === '23505') return { error: `"${name}" is already a category.`, status: 409 };
    throw error;
  }

  return { category: data };
}

async function deleteCategory(id) {
  const { error, count } = await supabase
    .from('product_categories')
    .delete({ count: 'exact' })
    .eq('id', id);

  if (error) throw error;
  if (!count) return { error: 'Category not found', status: 404 };
  return { deleted: true };
}

// Case-insensitive, because the unique index is too -- picking "filters" from
// an old product must count as the existing "Filters".
async function isKnownCategory(name) {
  const wanted = normalise(name).toLowerCase();
  if (!wanted) return false;
  const names = await listCategoryNames();
  return names.some((known) => known.toLowerCase() === wanted);
}

// Guards a product write. `currentCategory` is the value already stored on the
// product being edited (null when creating): products loaded before this list
// existed keep categories that aren't on it, and editing such a product's
// price or stock must not force a recategorisation -- only *changing* the
// category has to land on a value from the list.
async function assertCategoryAllowed(category, currentCategory = null) {
  const name = normalise(category);
  if (!name) return null;
  if (currentCategory && name.toLowerCase() === String(currentCategory).trim().toLowerCase()) return null;
  if (await isKnownCategory(name)) return null;

  return {
    error: `"${name}" is not one of the product categories. Pick an existing category, or add it first.`,
    status: 400,
  };
}

module.exports = {
  listCategories,
  listCategoryNames,
  createCategory,
  deleteCategory,
  isKnownCategory,
  assertCategoryAllowed,
};

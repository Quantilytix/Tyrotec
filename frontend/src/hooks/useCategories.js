import { useCallback, useEffect, useState } from 'react';
import { getCategories, createCategory, deleteCategory } from '../api/products';

// Loads the managed product category list once per page that needs it, and
// keeps it in sync after staff add or remove one -- so a category added inside
// the product form immediately shows up in the filter and the import screen on
// the same page, without a reload.
export default function useCategories() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(
    () =>
      getCategories()
        .then(({ data }) => setCategories(data))
        .finally(() => setLoading(false)),
    []
  );

  useEffect(() => {
    reload();
  }, [reload]);

  // Returns the created category so callers can select it straight away;
  // errors are left to the caller to show in its own form.
  const addCategory = useCallback(async (name) => {
    const { data } = await createCategory(name);
    setCategories((prev) =>
      [...prev, data].sort((a, b) => a.name.localeCompare(b.name))
    );
    return data;
  }, []);

  const removeCategory = useCallback(async (id) => {
    await deleteCategory(id);
    setCategories((prev) => prev.filter((category) => category.id !== id));
  }, []);

  return { categories, loading, reload, addCategory, removeCategory };
}

import { useState } from 'react';
import Button from '../ui/Button';

// Body of the "Manage categories" modal: add a category, or remove one from
// the list of choices.
//
// Removing a category never touches products. Products already in it keep
// their category text and stay in the catalogue -- they simply stop offering
// that choice for new products, until someone edits each product. The copy
// below says so, because "delete" on a category screen otherwise reads like
// it might delete the products too.
export default function CategoryManager({ categories, onAdd, onRemove }) {
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [confirmingId, setConfirmingId] = useState(null);
  const [removingId, setRemovingId] = useState(null);

  const handleAdd = async (event) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setError('');
    setAdding(true);
    try {
      await onAdd(trimmed);
      setName('');
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add this category.');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (category) => {
    setError('');
    setRemovingId(category.id);
    try {
      await onRemove(category.id);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not remove this category.');
    } finally {
      setRemovingId(null);
      setConfirmingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        These are the categories staff can choose when adding or importing products. Removing one only takes
        it off the list; products already in it keep their category until you edit them.
      </p>

      <form onSubmit={handleAdd} className="flex items-center gap-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="New category name"
          className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition-colors duration-150 focus:border-teal-500"
        />
        <Button type="submit" loading={adding} disabled={!name.trim()}>
          Add
        </Button>
      </form>

      {error && <p className="rounded-lg bg-bad-50 px-3 py-2 text-sm text-bad-500">{error}</p>}

      {categories.length === 0 ? (
        <p className="text-sm text-slate-500">No categories yet. Add the first one above.</p>
      ) : (
        <ul className="max-h-[45vh] divide-y divide-slate-100 overflow-auto rounded-lg border border-slate-200">
          {categories.map((category) => (
            <li key={category.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="text-ink">{category.name}</span>
              {confirmingId === category.id ? (
                <span className="flex items-center gap-3">
                  <span className="text-xs text-slate-500">Remove from list?</span>
                  <button
                    type="button"
                    onClick={() => handleRemove(category)}
                    disabled={removingId === category.id}
                    className="text-xs font-medium text-bad-500 transition-colors duration-150 hover:underline disabled:opacity-50"
                  >
                    {removingId === category.id ? 'Removing...' : 'Yes, remove'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingId(null)}
                    className="text-xs font-medium text-slate-500 transition-colors duration-150 hover:underline"
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingId(category.id)}
                  className="text-xs font-medium text-bad-500 transition-colors duration-150 hover:underline"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

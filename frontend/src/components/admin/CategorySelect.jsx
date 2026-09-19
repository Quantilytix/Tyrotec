import { useState } from 'react';

// Category picker used by the product form and the import review screen.
// Categories come from the managed list (useCategories), never free text --
// picking "+ Add new category..." saves a genuinely new one to that list and
// selects it, so the next product can just pick it.
//
// `value` may be a category that isn't on the list: products created before
// the list existed keep their old category text. That value is shown as an
// extra option marked "not in list" rather than being silently dropped, so
// editing such a product's price doesn't quietly change its category.

const ADD_NEW = '__add_new__';

export default function CategorySelect({
  value,
  onChange,
  categories,
  onCreateCategory,
  className,
  selectClassName,
  required = false,
  disabled = false,
  placeholder = 'Select a category',
}) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const names = categories.map((category) => category.name);
  const isOffList = Boolean(value) && !names.some((name) => name.toLowerCase() === value.toLowerCase());

  const handleSelect = (event) => {
    const next = event.target.value;
    if (next === ADD_NEW) {
      setNewName('');
      setError('');
      setAdding(true);
      return;
    }
    onChange(next);
  };

  const handleSave = async () => {
    const name = newName.trim();
    if (!name) return;
    setError('');
    setSaving(true);
    try {
      const created = await onCreateCategory(name);
      onChange(created.name);
      setAdding(false);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not add this category.');
    } finally {
      setSaving(false);
    }
  };

  if (adding) {
    return (
      <div className={className}>
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            // Enter would otherwise submit the surrounding product form and
            // save a product with no category chosen yet.
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleSave();
              }
              if (event.key === 'Escape') setAdding(false);
            }}
            placeholder="New category name"
            className={selectClassName}
            disabled={saving}
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !newName.trim()}
            className="shrink-0 text-xs font-medium text-teal-600 transition-colors duration-150 hover:underline disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => setAdding(false)}
            disabled={saving}
            className="shrink-0 text-xs font-medium text-slate-500 transition-colors duration-150 hover:underline"
          >
            Cancel
          </button>
        </div>
        {error && <p className="mt-1 text-xs text-bad-500">{error}</p>}
      </div>
    );
  }

  return (
    <div className={className}>
      <select
        value={value || ''}
        onChange={handleSelect}
        required={required}
        disabled={disabled}
        className={selectClassName}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {isOffList && <option value={value}>{value} (not in list)</option>}
        {categories.map((category) => (
          <option key={category.id} value={category.name}>
            {category.name}
          </option>
        ))}
        {onCreateCategory && <option value={ADD_NEW}>+ Add new category...</option>}
      </select>
    </div>
  );
}

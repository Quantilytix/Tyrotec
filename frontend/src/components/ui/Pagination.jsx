import { useState } from 'react';
import { pageItems, clampPage } from '../../utils/pagination';

const BASE =
  'min-w-9 rounded-lg border px-2.5 py-1.5 text-sm transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40';

// Page picker for long lists: Previous / numbered pages / Next, plus a box to
// jump straight to a page. Hidden when everything fits on one page.
export default function Pagination({ page, totalPages, onChange, className = '' }) {
  const [typed, setTyped] = useState('');
  if (totalPages <= 1) return null;

  const go = (target) => {
    if (target !== page) onChange(target);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const jump = (e) => {
    e.preventDefault();
    const target = clampPage(typed, totalPages);
    if (target) go(target);
    setTyped('');
  };

  return (
    <nav aria-label="Pages" className={`mt-6 flex flex-wrap items-center justify-center gap-1.5 ${className}`}>
      <button
        type="button"
        onClick={() => go(page - 1)}
        disabled={page <= 1}
        className={`${BASE} border-slate-200 bg-white text-ink hover:bg-slate-50`}
      >
        ‹ Previous
      </button>

      {pageItems(page, totalPages).map((item, i) =>
        item === '…' ? (
          <span key={`gap-${i}`} className="px-1 text-sm text-slate-400" aria-hidden="true">
            …
          </span>
        ) : (
          <button
            key={item}
            type="button"
            onClick={() => go(item)}
            aria-current={item === page ? 'page' : undefined}
            aria-label={`Page ${item}`}
            className={`${BASE} ${
              item === page
                ? 'border-teal-500 bg-teal-500 font-medium text-white'
                : 'border-slate-200 bg-white text-ink hover:bg-slate-50'
            }`}
          >
            {item}
          </button>
        )
      )}

      <button
        type="button"
        onClick={() => go(page + 1)}
        disabled={page >= totalPages}
        className={`${BASE} border-slate-200 bg-white text-ink hover:bg-slate-50`}
      >
        Next ›
      </button>

      <form onSubmit={jump} className="ml-2 flex items-center gap-1.5 text-sm text-slate-500">
        <label htmlFor="go-to-page">Go to page</label>
        <input
          id="go-to-page"
          type="number"
          min={1}
          max={totalPages}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={String(page)}
          className="w-16 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-ink outline-none transition-colors duration-150 focus:border-teal-500"
        />
        <span>of {totalPages}</span>
        <button type="submit" className={`${BASE} border-slate-200 bg-white text-ink hover:bg-slate-50`}>
          Go
        </button>
      </form>
    </nav>
  );
}

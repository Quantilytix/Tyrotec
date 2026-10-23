// The full photo of a product, opened from a thumbnail or a catalogue card.
// Used on the admin Products table and the customer catalogue, so a part
// can be checked properly before it's quoted.

export function PlaceholderIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function ProductImageViewer({ product, onClose }) {
  if (!product) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4 animate-modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Photo of ${product.name}`}
    >
      {/* Stop a click on the picture itself from closing, so only the
          surrounding backdrop and the button dismiss it. */}
      <div
        className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white animate-modal-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <p className="truncate font-display text-base font-semibold text-ink">{product.name}</p>
            <p className="truncate font-mono text-xs text-slate-400">{product.sku}</p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-slate-400 transition-colors duration-150 hover:bg-slate-100 hover:text-ink"
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-5 w-5">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-50 p-4">
          {product.image_url ? (
            // contain, not cover: a part photo must not be cropped when the
            // whole point of opening it is to look at the part.
            <img
              src={product.image_url}
              alt={product.name}
              className="max-h-[70vh] w-auto max-w-full object-contain"
            />
          ) : (
            <div className="flex flex-col items-center gap-3 py-16 text-slate-300">
              <PlaceholderIcon className="h-14 w-14" />
              <p className="text-sm text-slate-400">No photo for this product yet.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

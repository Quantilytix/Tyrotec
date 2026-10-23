import { useState } from 'react';
import ProductImageViewer, { PlaceholderIcon } from '../ui/ProductImageViewer';

// Kept exported from here too: the admin Products page imports it with the thumbnail.
export { ProductImageViewer };

// A small product picture for a table row. Clicking it opens the full image,
// which is the only way to actually check a photo from a list -- a 40px
// thumbnail is enough to recognise a part, not enough to verify it.
//
// Products without a photo still render a tile rather than nothing, so the
// Product column stays aligned down the whole table and a missing image is
// visible at a glance instead of looking like a rendering fault.

export default function ProductThumb({ product, onOpen }) {
  const [failed, setFailed] = useState(false);
  const hasImage = Boolean(product.image_url) && !failed;

  const shared =
    'h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-slate-200 transition-shadow duration-150';

  if (!hasImage) {
    return (
      <div
        className={`${shared} flex items-center justify-center bg-slate-50 text-slate-300`}
        title="No photo"
        aria-hidden="true"
      >
        <PlaceholderIcon className="h-5 w-5" />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(product)}
      className={`${shared} cursor-zoom-in hover:shadow-md`}
      aria-label={`View photo of ${product.name}`}
      title="Click to view"
    >
      <img
        src={product.image_url}
        alt=""
        // A broken or removed file falls back to the placeholder rather than
        // leaving the browser's torn-image icon in the table.
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
    </button>
  );
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const MENU_WIDTH = 208;

// A small dropdown of actions, for a table row ("Actions") or a page
// ("Update status").
//
// The menu is drawn in a portal, fixed to the screen, so a table's
// overflow-x-auto wrapper can't clip it, and it opens upwards when there
// isn't room below. Table rows open their record when clicked, so clicks on
// the button and the menu never reach the row.
//
// items: [{ label, onClick, danger?, hidden? } | { divider: true }]. Hidden
// items and stray dividers are dropped; with nothing left, nothing renders.
// size 'md' matches the page's other buttons; 'sm' suits a table row.
export default function ActionMenu({ label = 'Actions', items, align = 'right', variant = 'secondary', size = 'sm' }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  const shown = items
    .filter((item) => !item.hidden)
    .filter((item, i, list) => !item.divider || (i > 0 && i < list.length - 1 && !list[i - 1].divider));

  // Placed once it has rendered (hidden), when its height is known.
  useLayoutEffect(() => {
    if (!open || !menuRef.current || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const height = menuRef.current.offsetHeight;
    const left = Math.min(
      Math.max(align === 'right' ? rect.right - MENU_WIDTH : rect.left, 8),
      window.innerWidth - MENU_WIDTH - 8
    );
    const roomBelow = rect.bottom + 4 + height <= window.innerHeight - 8;
    const top = roomBelow || rect.top - height - 4 < 8 ? rect.bottom + 4 : rect.top - height - 4;
    setPosition({ top, left });
  }, [open, align]);

  useEffect(() => {
    if (!open) return undefined;
    const close = () => {
      setOpen(false);
      setPosition(null);
    };
    const onPointer = (e) => {
      if (!menuRef.current?.contains(e.target) && !buttonRef.current?.contains(e.target)) close();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    // A fixed menu would drift away from its button.
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  if (shown.length === 0) return null;

  const buttonStyle =
    variant === 'primary'
      ? 'bg-teal-500 text-white hover:bg-teal-600'
      : 'border border-slate-200 bg-white text-ink hover:bg-slate-50';

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setPosition(null);
          setOpen((value) => !value);
        }}
        className={`inline-flex items-center gap-1.5 rounded-lg font-medium transition-colors duration-150 ${
          size === 'md' ? 'px-4 py-2 text-sm' : 'px-3 py-1.5 text-xs'
        } ${buttonStyle}`}
      >
        {label}
        <svg viewBox="0 0 20 20" fill="currentColor" className={`h-3.5 w-3.5 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}>
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'fixed', top: position?.top ?? 0, left: position?.left ?? 0, width: MENU_WIDTH, visibility: position ? 'visible' : 'hidden' }}
            className="z-50 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-sm shadow-card"
          >
            {shown.map((item, i) =>
              item.divider ? (
                <div key={`divider-${i}`} className="my-1 border-t border-slate-100" />
              ) : (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    setPosition(null);
                    item.onClick();
                  }}
                  className={`block w-full px-3 py-2 text-left transition-colors duration-150 ${
                    item.danger ? 'text-bad-500 hover:bg-bad-50' : 'text-ink hover:bg-slate-50'
                  }`}
                >
                  {item.label}
                </button>
              )
            )}
          </div>,
          document.body
        )}
    </>
  );
}

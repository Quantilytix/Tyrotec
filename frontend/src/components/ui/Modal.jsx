export default function Modal({ title, onClose, children, wide = false }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 animate-modal-backdrop">
      <div className="absolute inset-0" onClick={onClose} />
      <div
        className={`relative flex max-h-[90vh] w-full flex-col rounded-2xl bg-white p-5 shadow-card animate-modal-panel sm:p-6 ${
          wide ? 'max-w-4xl' : 'max-w-lg'
        }`}
      >
        <div className="flex shrink-0 items-center justify-between">
          <h2 className="pr-2 font-display text-base font-semibold text-ink sm:text-lg">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-ink"
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-5 w-5">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">{children}</div>
      </div>
    </div>
  );
}

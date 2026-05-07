export default function BackNavigationButton({ className = '', fallbackPath = '/', onFallback }) {
  const handleBack = () => {
    if (window.history.length > 1) {
      window.history.back()
      return
    }

    if (typeof onFallback === 'function') {
      onFallback()
      return
    }

    window.location.assign(fallbackPath)
  }

  return (
    <button
      type="button"
      onClick={handleBack}
      className={`inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-600 bg-[#111827] px-4 py-2 text-sm font-semibold text-slate-200 shadow-sm transition hover:border-blue-400 hover:text-white active:scale-[0.98] ${className}`}
      aria-label="Go back"
    >
      <span aria-hidden="true" className="text-base">←</span>
      <span>Back</span>
    </button>
  )
}

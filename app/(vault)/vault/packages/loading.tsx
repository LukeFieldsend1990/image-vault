export default function PackagesLoading() {
  return (
    <div className="p-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="h-5 w-36 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
          <div className="mt-2 h-3.5 w-60 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
        </div>
        <div className="h-8 w-28 rounded animate-pulse flex-shrink-0" style={{ background: "var(--color-border)" }} />
      </div>

      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded border p-5" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-2">
                <div className="h-4 w-48 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
                <div className="h-3 w-80 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
                <div className="flex gap-1.5 mt-1">
                  {[48, 56, 40].map((w, j) => (
                    <div key={j} className="h-4 rounded-sm animate-pulse" style={{ width: w, background: "var(--color-border)" }} />
                  ))}
                </div>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <div className="h-8 w-20 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
                <div className="h-8 w-20 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

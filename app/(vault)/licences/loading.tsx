export default function LicencesLoading() {
  return (
    <div className="p-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="h-5 w-32 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
          <div className="mt-2 h-3.5 w-64 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
        </div>
        <div className="h-8 w-32 rounded animate-pulse flex-shrink-0" style={{ background: "var(--color-border)" }} />
      </div>

      <div className="mb-6 flex gap-1 border-b" style={{ borderColor: "var(--color-border)" }}>
        {[80, 64, 72, 56].map((w, i) => (
          <div key={i} className="mx-1 mb-2 h-4 rounded animate-pulse" style={{ width: w, background: "var(--color-border)" }} />
        ))}
      </div>

      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded border p-5" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-40 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
                  <div className="h-4 w-16 rounded-full animate-pulse" style={{ background: "var(--color-border)" }} />
                </div>
                <div className="h-3 w-72 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
                <div className="h-3 w-48 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
              </div>
              <div className="h-8 w-24 rounded animate-pulse flex-shrink-0" style={{ background: "var(--color-border)" }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DashboardLoading() {
  return (
    <div className="p-8">
      {/* Stats bar */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="rounded border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
            <div className="h-3 w-16 rounded animate-pulse mb-2" style={{ background: "var(--color-border)" }} />
            <div className="h-6 w-10 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
          </div>
        ))}
      </div>

      {/* Section header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="h-4 w-28 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
        <div className="h-8 w-28 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
      </div>

      {/* Package cards */}
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="border rounded-sm overflow-hidden" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
            <div className="px-5 py-4 flex items-center gap-4">
              <div className="h-3 w-3 rounded-sm animate-pulse flex-shrink-0" style={{ background: "var(--color-border)" }} />
              <div className="h-[116px] w-[88px] rounded animate-pulse flex-shrink-0" style={{ background: "var(--color-border)" }} />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-48 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
                <div className="h-3 w-32 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
                <div className="flex gap-1.5 mt-1">
                  {[40, 52, 44].map((w, j) => (
                    <div key={j} className="h-4 rounded-sm animate-pulse" style={{ width: w, background: "var(--color-border)" }} />
                  ))}
                </div>
              </div>
              <div className="hidden sm:flex items-center gap-3 flex-shrink-0">
                {[1, 2, 3, 4].map((j) => (
                  <div key={j} className="h-6 w-6 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

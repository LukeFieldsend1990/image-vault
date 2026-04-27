export default function RosterLoading() {
  return (
    <div className="p-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="h-5 w-28 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
          <div className="mt-2 h-3.5 w-56 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
        </div>
        <div className="h-8 w-28 rounded animate-pulse flex-shrink-0" style={{ background: "var(--color-border)" }} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="rounded border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
            <div className="flex items-center gap-3 mb-3">
              <div className="h-10 w-10 rounded-full animate-pulse flex-shrink-0" style={{ background: "var(--color-border)" }} />
              <div className="space-y-1.5 flex-1">
                <div className="h-4 w-32 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
                <div className="h-3 w-24 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
              </div>
            </div>
            <div className="h-3 w-full rounded animate-pulse" style={{ background: "var(--color-border)" }} />
          </div>
        ))}
      </div>
    </div>
  );
}

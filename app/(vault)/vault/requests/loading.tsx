export default function RequestsLoading() {
  return (
    <div className="p-8">
      <div className="mb-6">
        <div className="h-5 w-36 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
        <div className="mt-2 h-3.5 w-64 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
      </div>

      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded border p-5" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-2">
                <div className="h-4 w-44 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
                <div className="h-3 w-32 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
                <div className="h-5 w-36 rounded-full animate-pulse mt-1" style={{ background: "var(--color-border)" }} />
              </div>
              <div className="h-8 w-32 rounded animate-pulse flex-shrink-0" style={{ background: "var(--color-border)" }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

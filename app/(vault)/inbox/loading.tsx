export default function InboxLoading() {
  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="h-5 w-16 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
        <div className="h-8 w-24 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
      </div>

      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="rounded border p-4 flex items-start gap-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
            <div className="h-4 w-4 rounded-full animate-pulse flex-shrink-0 mt-0.5" style={{ background: "var(--color-border)" }} />
            <div className="flex-1 space-y-2 min-w-0">
              <div className="flex items-center justify-between gap-4">
                <div className="h-3.5 w-40 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
                <div className="h-3 w-20 rounded animate-pulse flex-shrink-0" style={{ background: "var(--color-border)" }} />
              </div>
              <div className="h-3 w-64 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
              <div className="h-3 w-full rounded animate-pulse" style={{ background: "var(--color-border)" }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

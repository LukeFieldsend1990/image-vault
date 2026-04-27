export default function VaultLicencesLoading() {
  return (
    <div className="p-8">
      <div className="mb-6">
        <div className="h-5 w-24 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
      </div>

      {/* Tab bar */}
      <div className="flex overflow-x-auto border-b mb-6" style={{ borderColor: "var(--color-border)" }}>
        {[80, 128, 64, 56].map((w, i) => (
          <div key={i} className="mx-1 mb-2.5 h-4 rounded animate-pulse flex-shrink-0" style={{ width: w, background: "var(--color-border)" }} />
        ))}
      </div>

      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded border p-5" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="h-4 w-44 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
                <div className="h-4 w-16 rounded-full animate-pulse" style={{ background: "var(--color-border)" }} />
                <div className="h-4 w-20 rounded-full animate-pulse" style={{ background: "var(--color-border)" }} />
              </div>
              <div className="h-3 w-64 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
              <div className="h-3 w-40 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
              <div className="h-3 w-28 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

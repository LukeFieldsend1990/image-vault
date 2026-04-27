export default function TalentDetailLoading() {
  return (
    <div className="p-8">
      {/* Talent header */}
      <div className="mb-8 flex items-start gap-5">
        <div className="h-20 w-20 rounded-full animate-pulse flex-shrink-0" style={{ background: "var(--color-border)" }} />
        <div className="flex-1 space-y-2 pt-1">
          <div className="h-5 w-48 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
          <div className="h-3.5 w-32 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
          <div className="flex gap-1.5 mt-2">
            {[56, 64, 48].map((w, i) => (
              <div key={i} className="h-4 rounded-full animate-pulse" style={{ width: w, background: "var(--color-border)" }} />
            ))}
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b mb-6" style={{ borderColor: "var(--color-border)" }}>
        {[72, 96, 80].map((w, i) => (
          <div key={i} className="mx-1 mb-2.5 h-4 rounded animate-pulse" style={{ width: w, background: "var(--color-border)" }} />
        ))}
      </div>

      {/* Content rows */}
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
            <div className="space-y-2">
              <div className="h-4 w-40 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
              <div className="h-3 w-72 rounded animate-pulse" style={{ background: "var(--color-border)" }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <div className="flex flex-col h-full">
      {/* ── Top bar ── */}
      <header
        className="flex items-center justify-between border-b px-8 py-5"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-[--color-ink]">
            Your Vault
          </h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
            0 scan packages
          </p>
        </div>
        <button
          className="flex items-center gap-2 bg-[--color-ink] px-4 py-2.5 text-xs font-medium tracking-wide text-white transition hover:bg-zinc-800"
          style={{ borderRadius: "var(--radius)" }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Scan Package
        </button>
      </header>

      {/* ── Content ── */}
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center max-w-xs">
          {/* Icon */}
          <div
            className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full"
            style={{ background: "var(--color-surface)" }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-muted)" }}>
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>

          <h2 className="text-sm font-semibold text-[--color-ink] mb-2">
            No scans yet
          </h2>
          <p className="text-xs leading-relaxed" style={{ color: "var(--color-muted)" }}>
            Upload your first likeness scan package. Files are encrypted in
            your browser before they leave your device.
          </p>

          <button
            className="mt-6 inline-flex items-center gap-2 border border-[--color-border] px-5 py-2.5 text-xs font-medium text-[--color-ink] transition hover:border-[--color-ink] hover:bg-[--color-surface]"
            style={{ borderRadius: "var(--radius)" }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 16 12 12 8 16" />
              <line x1="12" y1="12" x2="12" y2="21" />
              <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
            </svg>
            Upload Scan Package
          </button>
        </div>
      </div>

      {/* ── Stats bar ── */}
      <footer
        className="border-t px-8 py-4 flex items-center gap-8"
        style={{ borderColor: "var(--color-border)" }}
      >
        {[
          { label: "Total scans", value: "0" },
          { label: "Storage used", value: "0 GB" },
          { label: "Active licences", value: "0" },
          { label: "Pending requests", value: "0" },
        ].map((stat) => (
          <div key={stat.label}>
            <p className="text-[11px] uppercase tracking-wide" style={{ color: "var(--color-muted)" }}>
              {stat.label}
            </p>
            <p className="text-sm font-semibold text-[--color-ink] mt-0.5">
              {stat.value}
            </p>
          </div>
        ))}
      </footer>
    </div>
  );
}

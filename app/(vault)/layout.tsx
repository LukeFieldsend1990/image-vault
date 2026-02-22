import { NavLinks } from "./nav";

export default function VaultLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden">
      {/* ── Sidebar ── */}
      <aside
        className="flex w-56 flex-shrink-0 flex-col justify-between py-8"
        style={{ background: "var(--color-sidebar)", color: "var(--color-sidebar-fg)" }}
      >
        {/* Logo */}
        <div>
          <div className="px-6 mb-10">
            <div className="text-[10px] font-semibold tracking-[0.2em] uppercase" style={{ color: "var(--color-sidebar-muted)" }}>
              United Agents
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className="text-sm font-medium tracking-wide">
                Image Vault
              </div>
              {/* UA-style red accent line under the wordmark */}
            </div>
            <div className="mt-1.5 h-px w-6" style={{ background: "var(--color-accent)" }} />
          </div>

          <NavLinks />
        </div>

        {/* User */}
        <div
          className="mx-3 flex items-center gap-3 rounded px-3 py-3 cursor-pointer hover:bg-white/5 transition"
        >
          <div
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
            style={{ background: "var(--color-accent)", color: "#ffffff" }}
          >
            TA
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium" style={{ color: "var(--color-sidebar-fg)" }}>
              Talent Account
            </p>
            <p className="truncate text-[11px]" style={{ color: "var(--color-sidebar-muted)" }}>
              talent@unitedagents.co.uk
            </p>
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex flex-1 flex-col overflow-y-auto bg-[--color-bg]">
        {children}
      </main>
    </div>
  );
}

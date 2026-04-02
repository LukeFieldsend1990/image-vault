"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";

export default function SidebarShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close drawer on navigation
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setOpen(false); }, [pathname]);

  // Lock body scroll when drawer is open
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <>
      {/* ── Mobile top bar ── */}
      <div
        className="lg:hidden fixed top-0 left-0 right-0 z-30 flex items-center gap-3 px-4 h-12 border-b"
        style={{ background: "var(--color-sidebar)", borderColor: "rgba(255,255,255,0.08)" }}
      >
        <button
          onClick={() => setOpen(true)}
          className="p-1.5 rounded"
          aria-label="Open menu"
          style={{ color: "var(--color-sidebar-fg)" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <div>
          <div className="text-[9px] font-semibold tracking-[0.2em] uppercase" style={{ color: "var(--color-sidebar-muted)" }}>
            United Agents
          </div>
          <div className="text-xs font-medium leading-none tracking-wide" style={{ color: "var(--color-sidebar-fg)" }}>
            Image Vault
          </div>
        </div>
      </div>

      {/* ── Backdrop ── */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 z-40"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={() => setOpen(false)}
        />
      )}

      {/* ── Drawer (mobile) / Sidebar (desktop) ── */}
      <aside
        className={[
          // Desktop: always visible static sidebar
          "lg:relative lg:flex lg:translate-x-0 lg:w-56",
          // Mobile: fixed full-height drawer
          "fixed inset-y-0 left-0 z-50 w-[85vw] max-w-xs flex flex-col",
          "transition-transform duration-200 ease-in-out",
          open ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
        style={{
          background: "var(--color-sidebar)",
          color: "var(--color-sidebar-fg)",
          flexShrink: 0,
        }}
      >
        {/* Close button (mobile only) */}
        <button
          onClick={() => setOpen(false)}
          className="lg:hidden absolute top-3 right-3 p-1.5 rounded opacity-50 hover:opacity-100 transition"
          aria-label="Close menu"
          style={{ color: "var(--color-sidebar-fg)" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {children}
      </aside>
    </>
  );
}

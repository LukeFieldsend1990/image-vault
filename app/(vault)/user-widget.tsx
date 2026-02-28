"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { TalentIdentity } from "./layout";

interface Props {
  email: string;
  initials: string;
  role: string;
  identity?: TalentIdentity | null;
}

export default function UserWidget({ email, initials, role, identity }: Props) {
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  async function logout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
    }
  }

  // Resolved display name and photo
  const displayName = identity?.fullName ?? null;
  const photoUrl = identity?.profileImageUrl ?? null;

  return (
    <div ref={ref} className="relative mx-3">
      {/* Dropdown — renders above the avatar */}
      {open && (
        <div
          className="absolute bottom-full mb-2 left-0 right-0 rounded border shadow-lg z-50 overflow-hidden"
          style={{ background: "var(--color-sidebar)", borderColor: "rgba(255,255,255,0.1)" }}
        >
          {/* Identity header */}
          <div className="px-4 py-3 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
            {displayName ? (
              <>
                <p className="text-xs font-semibold" style={{ color: "var(--color-sidebar-fg)" }}>{displayName}</p>
                <p className="text-[10px] mt-0.5 truncate" style={{ color: "var(--color-sidebar-muted)" }}>{email}</p>
              </>
            ) : (
              <p className="text-xs font-medium" style={{ color: "var(--color-sidebar-fg)" }}>{email || "—"}</p>
            )}
            <p
              className="mt-1 text-[10px] capitalize font-medium px-1.5 py-0.5 rounded inline-block"
              style={{ background: "rgba(192,57,43,0.2)", color: "var(--color-accent)" }}
            >
              {role}
            </p>
          </div>

          {/* Menu items */}
          <div className="py-1">
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-4 py-2.5 text-xs transition hover:bg-white/5"
              style={{ color: "var(--color-sidebar-muted)" }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              Account settings
            </Link>

            {role === "talent" && (
              <Link
                href="/settings/delegation"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-4 py-2.5 text-xs transition hover:bg-white/5"
                style={{ color: "var(--color-sidebar-muted)" }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                Manage representatives
              </Link>
            )}

            {role === "rep" && (
              <Link
                href="/roster"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-4 py-2.5 text-xs transition hover:bg-white/5"
                style={{ color: "var(--color-sidebar-muted)" }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                My roster
              </Link>
            )}
          </div>

          {/* Logout */}
          <div className="border-t py-1" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
            <button
              onClick={logout}
              disabled={loggingOut}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs transition hover:bg-white/5 disabled:opacity-50"
              style={{ color: "var(--color-danger)" }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              {loggingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      )}

      {/* ── Trigger ── */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 rounded px-3 py-3 transition hover:bg-white/5"
      >
        {/* Avatar — TMDB photo if available, else initials */}
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl}
            alt={displayName ?? ""}
            className="h-7 w-7 shrink-0 rounded-full object-cover object-top"
            style={{ border: "1.5px solid rgba(255,255,255,0.15)" }}
          />
        ) : (
          <div
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
            style={{ background: "var(--color-accent)", color: "#ffffff" }}
          >
            {initials}
          </div>
        )}

        <div className="min-w-0 text-left">
          <p className="truncate text-xs font-medium" style={{ color: "var(--color-sidebar-fg)" }}>
            {displayName ?? role}
          </p>
          <p className="truncate text-[11px]" style={{ color: "var(--color-sidebar-muted)" }}>
            {email || "—"}
          </p>
        </div>

        <svg
          width="12" height="12"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
          className="ml-auto flex-shrink-0 transition-transform"
          style={{ color: "var(--color-sidebar-muted)", transform: open ? "rotate(180deg)" : "none" }}
        >
          <polyline points="18 15 12 9 6 15" />
        </svg>
      </button>
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  read: boolean;
  createdAt: number;
}

function timeAgo(epoch: number): string {
  const s = Math.floor(Date.now() / 1000) - epoch;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const d = (await res.json()) as { notifications?: Notification[]; unreadCount?: number };
      setItems(d.notifications ?? []);
      setUnread(d.unreadCount ?? 0);
    } catch {
      // ignore
    }
  }, []);

  // Initial load + poll every 60s. The initial fetch is deferred a tick so it
  // doesn't set state synchronously inside the effect.
  useEffect(() => {
    const initial = setTimeout(() => void load(), 0);
    const t = setInterval(() => void load(), 60_000);
    return () => { clearTimeout(initial); clearInterval(t); };
  }, [load]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function openPanel() {
    setOpen(true);
    await load();
    if (unread > 0) {
      setUnread(0);
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
      try {
        await fetch("/api/notifications/mark-read", { method: "POST" });
      } catch {
        // ignore
      }
    }
  }

  return (
    <div className="relative px-6 mb-2">
      <button
        onClick={() => (open ? setOpen(false) : void openPanel())}
        className="flex items-center gap-2.5 w-full text-left text-sm transition-opacity hover:opacity-100"
        style={{ color: "var(--color-muted)", opacity: 0.85 }}
      >
        <span className="relative inline-flex">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {unread > 0 && (
            <span
              className="absolute -top-1.5 -right-1.5 min-w-[14px] h-[14px] px-1 rounded-full text-[9px] font-bold text-white flex items-center justify-center"
              style={{ background: "var(--color-accent)" }}
            >
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </span>
        Notifications
      </button>

      {open && (
        <div
          ref={panelRef}
          className="fixed z-50 w-80 max-h-[60vh] overflow-y-auto rounded border shadow-xl"
          style={{ left: 16, bottom: 88, background: "var(--color-bg)", borderColor: "var(--color-border)" }}
        >
          <div className="px-4 py-3 border-b text-xs font-semibold uppercase tracking-widest" style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}>
            Notifications
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-sm text-center" style={{ color: "var(--color-muted)" }}>Nothing yet.</p>
          ) : (
            <div className="divide-y" style={{ borderColor: "var(--color-border)" }}>
              {items.map((n) => {
                const inner = (
                  <div className="px-4 py-3 transition-colors hover:bg-[var(--color-surface)]">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>{n.title}</p>
                      <span className="text-[10px] shrink-0 mt-0.5" style={{ color: "var(--color-muted)" }}>{timeAgo(n.createdAt)}</span>
                    </div>
                    {n.body && <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>{n.body}</p>}
                  </div>
                );
                return n.href
                  ? <a key={n.id} href={n.href} className="block">{inner}</a>
                  : <div key={n.id}>{inner}</div>;
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

interface Suggestion {
  id: string;
  category: "action_required" | "attention" | "insight" | "security";
  title: string;
  body: string;
  deepLink: string | null;
  actionLabel: string | null;
}

const CATEGORY_STYLES: Record<
  Suggestion["category"],
  { bg: string; color: string; label: string; bold?: boolean }
> = {
  action_required: { bg: "#dc262618", color: "#dc2626", label: "Action Required" },
  attention: { bg: "#d9770618", color: "#d97706", label: "Attention" },
  insight: { bg: "#2563eb18", color: "#2563eb", label: "Insight" },
  security: { bg: "#dc262624", color: "#dc2626", label: "Security", bold: true },
};

export default function SuggestionsPanel() {
  const router = useRouter();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(true);
  const [dismissing, setDismissing] = useState<Set<string>>(new Set());
  const [aiDisabled, setAiDisabled] = useState(false);

  useEffect(() => {
    fetch("/api/suggestions")
      .then((r) => r.json() as Promise<{ suggestions?: Suggestion[]; aiDisabled?: boolean }>)
      .then((d) => {
        setSuggestions(d.suggestions ?? []);
        if (d.aiDisabled) setAiDisabled(true);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleDismiss = useCallback(
    (id: string) => {
      setDismissing((prev) => new Set(prev).add(id));
      fetch(`/api/suggestions/${id}/acknowledge`, { method: "PATCH" }).catch(() => {});
      setTimeout(() => {
        setSuggestions((prev) => prev.filter((s) => s.id !== id));
        setDismissing((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 300);
    },
    [],
  );

  const handleView = useCallback(
    (suggestion: Suggestion) => {
      if (!suggestion.deepLink) return;
      fetch(`/api/suggestions/${suggestion.id}/click`, { method: "PATCH" }).catch(() => {});
      router.push(suggestion.deepLink);
    },
    [router],
  );

  const count = suggestions.length;

  // Hide panel entirely when AI is disabled for this user
  if (aiDisabled) return null;

  return (
    <div
      className="rounded border mb-6 overflow-hidden"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between px-5 py-3 text-left transition hover:opacity-80"
        style={{ borderBottom: collapsed ? "none" : "1px solid var(--color-border)" }}
      >
        <div className="flex items-center gap-2.5">
          <p className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
            Suggestions
          </p>
          {!loading && count > 0 && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none"
              style={{ background: "var(--color-accent)", color: "#fff", minWidth: 18, textAlign: "center" }}
            >
              {count}
            </span>
          )}
        </div>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            color: "var(--color-muted)",
            transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
            transition: "transform 200ms ease",
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Body */}
      {!collapsed && (
        <div className="px-5 py-4">
          {/* Loading state */}
          {loading && (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div
                  key={i}
                  className="rounded border animate-pulse"
                  style={{
                    borderColor: "var(--color-border)",
                    background: "var(--color-background)",
                    height: 72,
                  }}
                />
              ))}
            </div>
          )}

          {/* Empty state */}
          {!loading && count === 0 && (
            <p className="text-sm py-4 text-center" style={{ color: "var(--color-muted)" }}>
              No suggestions right now. Check back later.
            </p>
          )}

          {/* Suggestion cards */}
          {!loading && count > 0 && (
            <div className="space-y-3">
              {suggestions.map((s) => {
                const catStyle = CATEGORY_STYLES[s.category];
                const isDismissing = dismissing.has(s.id);

                return (
                  <div
                    key={s.id}
                    className="rounded border px-4 py-3"
                    style={{
                      borderColor: "var(--color-border)",
                      background: "var(--color-background)",
                      opacity: isDismissing ? 0 : 1,
                      maxHeight: isDismissing ? 0 : 200,
                      overflow: "hidden",
                      padding: isDismissing ? "0 16px" : undefined,
                      marginBottom: isDismissing ? 0 : undefined,
                      transition: "opacity 300ms ease, max-height 300ms ease, padding 300ms ease, margin-bottom 300ms ease",
                    }}
                  >
                    {/* Category badge + title */}
                    <div className="flex items-start gap-2.5 mb-1.5">
                      <span
                        className="shrink-0 mt-0.5 text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded leading-none"
                        style={{
                          background: catStyle.bg,
                          color: catStyle.color,
                          fontWeight: catStyle.bold ? 800 : 600,
                        }}
                      >
                        {catStyle.label}
                      </span>
                      <p className="text-sm font-semibold leading-snug" style={{ color: "var(--color-ink)" }}>
                        {s.title}
                      </p>
                    </div>

                    {/* Body */}
                    <p className="text-xs leading-relaxed mb-3" style={{ color: "var(--color-muted)" }}>
                      {s.body}
                    </p>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      {s.deepLink && (
                        <button
                          type="button"
                          onClick={() => handleView(s)}
                          className="rounded border px-3 py-1.5 text-xs font-medium transition hover:opacity-70"
                          style={{
                            borderColor: "var(--color-accent)",
                            color: "var(--color-accent)",
                            background: "transparent",
                          }}
                        >
                          {s.actionLabel ?? "View"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDismiss(s.id)}
                        className="rounded border px-3 py-1.5 text-xs font-medium transition hover:opacity-70"
                        style={{
                          borderColor: "var(--color-border)",
                          color: "var(--color-muted)",
                          background: "transparent",
                        }}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

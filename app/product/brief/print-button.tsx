"use client";

export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print rounded border px-3 py-1.5 text-xs font-medium transition hover:opacity-70"
      style={{ borderColor: "var(--color-border)", color: "var(--color-muted)", background: "var(--color-surface)" }}
    >
      Print / save as PDF
    </button>
  );
}

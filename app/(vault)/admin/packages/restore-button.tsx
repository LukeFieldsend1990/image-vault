"use client";

import { useState } from "react";

export default function RestoreButton({ packageId }: { packageId: string }) {
  const [loading, setLoading] = useState(false);
  const [restored, setRestored] = useState(false);

  async function handleRestore() {
    if (!confirm("Restore this package? It will become visible to the talent again.")) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/packages/${packageId}/restore`, { method: "POST" });
      if (res.ok) setRestored(true);
    } finally {
      setLoading(false);
    }
  }

  if (restored) {
    return (
      <span className="text-[9px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded" style={{ background: "#16653418", color: "#166534" }}>
        Restored
      </span>
    );
  }

  return (
    <button
      onClick={() => void handleRestore()}
      disabled={loading}
      className="text-[10px] font-medium px-2 py-1 rounded transition disabled:opacity-50"
      style={{ color: "var(--color-accent)", border: "1px solid var(--color-border)" }}
    >
      {loading ? "Restoring…" : "Restore"}
    </button>
  );
}

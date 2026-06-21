"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ReviewButton({ recordId }: { recordId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function review() {
    const note = window.prompt("Add a review note (optional) — this marks the claim as reviewed:", "");
    if (note === null) return; // cancelled
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/inclusions/${recordId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      if (r.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={review}
      disabled={busy}
      className="shrink-0 text-xs font-medium px-3 py-1.5 rounded text-white"
      style={{ background: "var(--color-accent)", opacity: busy ? 0.6 : 1 }}
    >
      {busy ? "Saving…" : "Mark reviewed"}
    </button>
  );
}

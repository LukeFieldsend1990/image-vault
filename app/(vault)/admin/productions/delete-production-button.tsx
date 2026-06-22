"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteProductionButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (deleting) return;
    if (
      !window.confirm(
        `Delete “${name}”?\n\nThis removes the production along with its cast roster, default terms and vendor links. Any existing licences are detached but kept. This cannot be undone.`
      )
    ) {
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(`/api/productions/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        alert(d.error ?? "Failed to delete production.");
        return;
      }
      router.refresh();
    } catch {
      alert("Network error. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <button
      onClick={handleDelete}
      disabled={deleting}
      title="Delete production"
      aria-label={`Delete ${name}`}
      className="p-1.5 rounded opacity-0 group-hover:opacity-100 focus:opacity-100 transition hover:bg-[var(--color-surface)] disabled:opacity-50"
      style={{ color: "var(--color-muted)" }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <line x1="10" y1="11" x2="10" y2="17" />
        <line x1="14" y1="11" x2="14" y2="17" />
      </svg>
    </button>
  );
}

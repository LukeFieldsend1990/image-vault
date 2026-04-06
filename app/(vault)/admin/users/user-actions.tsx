"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  userId: string;
  isSuspended: boolean;
  isCurrentUser: boolean;
  emailMuted: boolean;
  aiDisabled: boolean;
  inboundEnabled: boolean;
}

export default function UserActions({ userId, isSuspended, isCurrentUser, emailMuted, aiDisabled, inboundEnabled }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<"suspend" | "delete" | "email" | "ai" | "inbound" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (isCurrentUser) {
    return <span className="text-xs" style={{ color: "var(--color-muted)" }}>—</span>;
  }

  async function handleSuspend() {
    setLoading("suspend");
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suspended: !isSuspended }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? "Failed");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(null);
    }
  }

  async function handleEmailToggle() {
    setLoading("email");
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailMuted: !emailMuted }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? "Failed");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(null);
    }
  }

  async function handleAiToggle() {
    setLoading("ai");
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiDisabled: !aiDisabled }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? "Failed");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(null);
    }
  }

  async function handleInboundToggle() {
    setLoading("inbound");
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inboundEnabled: !inboundEnabled }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? "Failed");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(null);
    }
  }

  async function handleDelete() {
    if (!confirm(`Permanently delete this user? This cannot be undone.`)) return;
    setLoading("delete");
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? "Failed");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleSuspend}
        disabled={loading !== null}
        className="text-[10px] font-semibold px-2 py-0.5 rounded border transition disabled:opacity-40"
        style={isSuspended
          ? { borderColor: "rgba(22,101,52,0.3)", color: "#166534", background: "rgba(22,101,52,0.06)" }
          : { borderColor: "rgba(217,119,6,0.3)", color: "#d97706", background: "rgba(217,119,6,0.06)" }
        }
      >
        {loading === "suspend" ? "…" : isSuspended ? "Unsuspend" : "Suspend"}
      </button>
      <button
        onClick={handleEmailToggle}
        disabled={loading !== null}
        className="text-[10px] font-semibold px-2 py-0.5 rounded border transition disabled:opacity-40"
        style={emailMuted
          ? { borderColor: "rgba(22,101,52,0.3)", color: "#166534", background: "rgba(22,101,52,0.06)" }
          : { borderColor: "rgba(107,114,128,0.3)", color: "#6b7280", background: "rgba(107,114,128,0.06)" }
        }
      >
        {loading === "email" ? "…" : emailMuted ? "Unmute Email" : "Mute Email"}
      </button>
      <button
        onClick={handleAiToggle}
        disabled={loading !== null}
        className="text-[10px] font-semibold px-2 py-0.5 rounded border transition disabled:opacity-40"
        style={aiDisabled
          ? { borderColor: "rgba(22,101,52,0.3)", color: "#166534", background: "rgba(22,101,52,0.06)" }
          : { borderColor: "rgba(139,92,246,0.3)", color: "#8b5cf6", background: "rgba(139,92,246,0.06)" }
        }
      >
        {loading === "ai" ? "…" : aiDisabled ? "Enable AI" : "Disable AI"}
      </button>
      <button
        onClick={handleInboundToggle}
        disabled={loading !== null}
        className="text-[10px] font-semibold px-2 py-0.5 rounded border transition disabled:opacity-40"
        style={inboundEnabled
          ? { borderColor: "rgba(22,101,52,0.3)", color: "#166534", background: "rgba(22,101,52,0.06)" }
          : { borderColor: "rgba(37,99,235,0.3)", color: "#2563eb", background: "rgba(37,99,235,0.06)" }
        }
      >
        {loading === "inbound" ? "…" : inboundEnabled ? "Inbox On" : "Enable Inbox"}
      </button>
      <button
        onClick={handleDelete}
        disabled={loading !== null}
        className="text-[10px] font-semibold px-2 py-0.5 rounded border transition disabled:opacity-40"
        style={{ borderColor: "rgba(192,57,43,0.3)", color: "#c0392b", background: "rgba(192,57,43,0.06)" }}
      >
        {loading === "delete" ? "…" : "Delete"}
      </button>
      {error && (
        <span className="text-[10px]" style={{ color: "#c0392b" }}>{error}</span>
      )}
    </div>
  );
}

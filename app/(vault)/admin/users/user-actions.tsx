"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Role = "talent" | "rep" | "industry" | "licensee" | "admin";

const ROLE_COLOR: Record<Role, string> = {
  talent: "#4f46e5",
  rep: "#0891b2",
  industry: "#059669",
  licensee: "#059669",
  admin: "#c0392b",
};

interface Props {
  userId: string;
  role: Role;
  isSuspended: boolean;
  isCurrentUser: boolean;
  emailMuted: boolean;
  aiDisabled: boolean;
  inboundEnabled: boolean;
  geoFingerprintEnabled: boolean;
  royaltyMeterEnabled: boolean;
  complianceEnabled: boolean;
  financialVisibilityEnabled: boolean;
  pitchVignettesEnabled: boolean;
}

export default function UserActions({ userId, role, isSuspended, isCurrentUser, emailMuted, aiDisabled, inboundEnabled, geoFingerprintEnabled, royaltyMeterEnabled, complianceEnabled, financialVisibilityEnabled, pitchVignettesEnabled }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<"suspend" | "delete" | "email" | "ai" | "inbound" | "geo" | "royalty" | "compliance" | "financial" | "pitch" | "role" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRoleChange(newRole: Role) {
    if (newRole === role) return;
    setLoading("role");
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
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

  async function handleGeoFingerprintToggle() {
    setLoading("geo");
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ geoFingerprintEnabled: !geoFingerprintEnabled }),
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

  async function handleRoyaltyToggle() {
    setLoading("royalty");
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ royaltyMeterEnabled: !royaltyMeterEnabled }),
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

  async function handleComplianceToggle() {
    setLoading("compliance");
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ complianceEnabled: !complianceEnabled }),
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

  async function handleFinancialToggle() {
    setLoading("financial");
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ financialVisibilityEnabled: !financialVisibilityEnabled }),
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

  async function handlePitchVignettesToggle() {
    setLoading("pitch");
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pitchVignettesEnabled: !pitchVignettesEnabled }),
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
    <div className="flex flex-wrap items-center gap-1.5">
      {!isCurrentUser && (
        <select
          value={role}
          disabled={loading !== null}
          onChange={(e) => void handleRoleChange(e.target.value as Role)}
          className="text-[10px] font-semibold px-2 py-1 rounded border appearance-none cursor-pointer disabled:opacity-40"
          style={{
            borderColor: `${ROLE_COLOR[role]}40`,
            color: ROLE_COLOR[role],
            background: `${ROLE_COLOR[role]}10`,
          }}
        >
          <option value="talent">Talent</option>
          <option value="rep">Rep</option>
          <option value="industry">Industry</option>
          <option value="licensee">Licensee</option>
        </select>
      )}
      {!isCurrentUser && (
        <button
          onClick={handleSuspend}
          disabled={loading !== null}
          className="text-[10px] font-semibold px-2.5 py-1 rounded border transition disabled:opacity-40 whitespace-nowrap"
          style={isSuspended
            ? { borderColor: "rgba(22,101,52,0.3)", color: "#166534", background: "rgba(22,101,52,0.06)" }
            : { borderColor: "rgba(217,119,6,0.3)", color: "#d97706", background: "rgba(217,119,6,0.06)" }
          }
        >
          {loading === "suspend" ? "…" : isSuspended ? "Unsuspend" : "Suspend"}
        </button>
      )}
      <button
        onClick={handleEmailToggle}
        disabled={loading !== null}
        className="text-[10px] font-semibold px-2.5 py-1 rounded border transition disabled:opacity-40 whitespace-nowrap"
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
        className="text-[10px] font-semibold px-2.5 py-1 rounded border transition disabled:opacity-40 whitespace-nowrap"
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
        className="text-[10px] font-semibold px-2.5 py-1 rounded border transition disabled:opacity-40 whitespace-nowrap"
        style={inboundEnabled
          ? { borderColor: "rgba(22,101,52,0.3)", color: "#166534", background: "rgba(22,101,52,0.06)" }
          : { borderColor: "rgba(37,99,235,0.3)", color: "#2563eb", background: "rgba(37,99,235,0.06)" }
        }
      >
        {loading === "inbound" ? "…" : inboundEnabled ? "Inbox On" : "Enable Inbox"}
      </button>
      <button
        onClick={handleGeoFingerprintToggle}
        disabled={loading !== null}
        className="text-[10px] font-semibold px-2.5 py-1 rounded border transition disabled:opacity-40 whitespace-nowrap"
        style={geoFingerprintEnabled
          ? { borderColor: "rgba(5,150,105,0.3)", color: "#059669", background: "rgba(5,150,105,0.06)" }
          : { borderColor: "rgba(107,114,128,0.3)", color: "#6b7280", background: "rgba(107,114,128,0.06)" }
        }
      >
        {loading === "geo" ? "…" : geoFingerprintEnabled ? "Fingerprint On" : "Fingerprint Off"}
      </button>
      <button
        onClick={handleRoyaltyToggle}
        disabled={loading !== null}
        className="text-[10px] font-semibold px-2.5 py-1 rounded border transition disabled:opacity-40 whitespace-nowrap"
        style={royaltyMeterEnabled
          ? { borderColor: "rgba(192,57,43,0.3)", color: "#c0392b", background: "rgba(192,57,43,0.06)" }
          : { borderColor: "rgba(107,114,128,0.3)", color: "#6b7280", background: "rgba(107,114,128,0.06)" }
        }
      >
        {loading === "royalty" ? "…" : royaltyMeterEnabled ? "Royalties On" : "Royalties Off"}
      </button>
      <button
        onClick={handleComplianceToggle}
        disabled={loading !== null}
        className="text-[10px] font-semibold px-2.5 py-1 rounded border transition disabled:opacity-40 whitespace-nowrap"
        style={complianceEnabled
          ? { borderColor: "rgba(8,145,178,0.3)", color: "#0891b2", background: "rgba(8,145,178,0.06)" }
          : { borderColor: "rgba(107,114,128,0.3)", color: "#6b7280", background: "rgba(107,114,128,0.06)" }
        }
      >
        {loading === "compliance" ? "…" : complianceEnabled ? "Compliance On" : "Compliance Off"}
      </button>
      {role === "talent" && (
        <button
          onClick={handleFinancialToggle}
          disabled={loading !== null}
          className="text-[10px] font-semibold px-2.5 py-1 rounded border transition disabled:opacity-40 whitespace-nowrap"
          title="Show the under-test fee model to this talent"
          style={financialVisibilityEnabled
            ? { borderColor: "rgba(124,138,87,0.4)", color: "#5d6b3a", background: "rgba(124,138,87,0.08)" }
            : { borderColor: "rgba(107,114,128,0.3)", color: "#6b7280", background: "rgba(107,114,128,0.06)" }
          }
        >
          {loading === "financial" ? "…" : financialVisibilityEnabled ? "Fees Visible" : "Fees Hidden"}
        </button>
      )}
      {role === "talent" && (
        <button
          onClick={handlePitchVignettesToggle}
          disabled={loading !== null}
          className="text-[10px] font-semibold px-2.5 py-1 rounded border transition disabled:opacity-40 whitespace-nowrap"
          style={pitchVignettesEnabled
            ? { borderColor: "rgba(192,57,43,0.3)", color: "#c0392b", background: "rgba(192,57,43,0.06)" }
            : { borderColor: "rgba(107,114,128,0.3)", color: "#6b7280", background: "rgba(107,114,128,0.06)" }
          }
        >
          {loading === "pitch" ? "…" : pitchVignettesEnabled ? "Pitches On" : "Pitches Off"}
        </button>
      )}
      {!isCurrentUser && (
        <button
          onClick={handleDelete}
          disabled={loading !== null}
          className="text-[10px] font-semibold px-2.5 py-1 rounded border transition disabled:opacity-40 whitespace-nowrap"
          style={{ borderColor: "rgba(192,57,43,0.3)", color: "#c0392b", background: "rgba(192,57,43,0.06)" }}
        >
          {loading === "delete" ? "…" : "Delete"}
        </button>
      )}
      {error && (
        <span className="text-[10px]" style={{ color: "#c0392b" }}>{error}</span>
      )}
    </div>
  );
}

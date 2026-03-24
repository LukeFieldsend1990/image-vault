"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RevokeGrantButton({ grantId }: { grantId: string }) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const router = useRouter();

  async function revoke() {
    if (!confirm("Revoke this bridge session? The Bridge app will be denied access immediately.")) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/bridge/grants/${grantId}`, { method: "DELETE" });
      if (res.ok) {
        setDone(true);
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <span className="text-[10px]" style={{ color: "#166534" }}>Revoked</span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void revoke()}
      disabled={loading}
      className="text-xs font-medium transition hover:opacity-70 disabled:opacity-40"
      style={{ color: "var(--color-danger)" }}
    >
      {loading ? (
        <svg className="animate-spin" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        </svg>
      ) : "Revoke"}
    </button>
  );
}

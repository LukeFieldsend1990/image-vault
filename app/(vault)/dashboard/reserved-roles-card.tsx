"use client";

import { useEffect, useState } from "react";

interface ClaimableRole {
  castId: string;
  productionId: string;
  productionName: string;
  companyName: string;
  characterName: string | null;
  matchType: "tmdb" | "name";
}

// Path D self-heal surface on the talent dashboard: reserved roles that match
// this talent (by tmdbId or name). The talent confirms ("This is me") to claim,
// which links the cast row and notifies the production company.
export default function ReservedRolesCard() {
  const [roles, setRoles] = useState<ClaimableRole[]>([]);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [claimed, setClaimed] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/cast/claimable")
      .then((r) => r.json() as Promise<{ roles?: ClaimableRole[] }>)
      .then((d) => setRoles(d.roles ?? []))
      .catch(() => {});
  }, []);

  async function dismiss(castId: string) {
    setDismissed((prev) => new Set(prev).add(castId));
    setDismissingId(castId);
    try {
      await fetch("/api/cast/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ castId }),
      });
    } finally {
      setDismissingId(null);
    }
  }

  async function claim(role: ClaimableRole) {
    setClaimingId(role.castId);
    try {
      const r = await fetch(`/api/productions/${role.productionId}/cast/${role.castId}/claim`, { method: "POST" });
      if (r.ok) {
        setClaimed((prev) => new Set(prev).add(role.castId));
      }
    } finally {
      setClaimingId(null);
    }
  }

  const visible = roles.filter((r) => !dismissed.has(r.castId));
  if (visible.length === 0) return null;

  return (
    <div
      className="mx-8 lg:mx-12 mt-5 rounded border px-5 py-4"
      style={{ borderColor: "var(--color-accent)", background: "color-mix(in srgb, var(--color-accent) 5%, var(--color-bg))" }}
    >
      <p className="text-xs font-semibold mb-3" style={{ color: "var(--color-accent)" }}>
        {visible.length === 1 ? "A production reserved a role for you" : `${visible.length} productions reserved a role for you`}
      </p>
      <div className="space-y-2">
        {visible.map((role) => {
          const isClaimed = claimed.has(role.castId);
          return (
            <div
              key={role.castId}
              className="flex items-center gap-3 rounded px-3 py-2.5"
              style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm" style={{ color: "var(--color-ink)" }}>
                  <span className="font-medium">{role.characterName ? role.characterName : "A role"}</span>
                  {" in "}
                  <span className="font-medium">{role.productionName}</span>
                </p>
                <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                  Reserved by {role.companyName}
                  {role.matchType === "name" && " · matched by name"}
                </p>
              </div>
              {isClaimed ? (
                <span className="text-xs font-medium px-3 py-1.5" style={{ color: "#166534" }}>Claimed ✓</span>
              ) : (
                <>
                  <button
                    onClick={() => claim(role)}
                    disabled={claimingId === role.castId}
                    className="text-xs font-medium px-3 py-1.5 rounded text-white shrink-0"
                    style={{ background: "var(--color-accent)", opacity: claimingId === role.castId ? 0.6 : 1 }}
                  >
                    {claimingId === role.castId ? "Claiming…" : "This is me"}
                  </button>
                  <button
                    onClick={() => dismiss(role.castId)}
                    disabled={dismissingId === role.castId}
                    className="text-xs px-2 py-1.5 shrink-0"
                    style={{ color: "var(--color-muted)", opacity: dismissingId === role.castId ? 0.5 : 1 }}
                  >
                    Not me
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

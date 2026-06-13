"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import OrgTypeBadge from "@/app/components/org-type-badge";

interface InvitePreview {
  organisationId: string;
  organisationName: string;
  organisationType?: string | null;
  invitedEmail: string;
  expiresAt: number;
}

export default function JoinClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("No invite token provided.");
      setLoading(false);
      return;
    }
    void fetch(`/api/organisations/join?token=${encodeURIComponent(token)}`)
      .then(async r => {
        const d = await r.json() as InvitePreview & { error?: string };
        if (!r.ok) {
          setError(d.error ?? "Invalid invite");
        } else {
          setPreview(d);
        }
      })
      .catch(() => setError("Failed to load invite details"))
      .finally(() => setLoading(false));
  }, [token]);

  async function acceptInvite() {
    if (!token) return;
    setJoining(true);
    try {
      const r = await fetch("/api/organisations/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const d = await r.json() as { organisationId?: string; error?: string };
      if (!r.ok) {
        setError(d.error ?? "Failed to join organisation");
      } else {
        setJoined(true);
        setTimeout(() => router.push("/settings/organisation"), 2000);
      }
    } catch {
      setError("Network error — please try again");
    } finally {
      setJoining(false);
    }
  }

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "4rem 1.5rem" }}>
        <p style={{ color: "var(--color-muted)", fontSize: "0.875rem" }}>Verifying invite…</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "4rem 1.5rem" }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        {error ? (
          <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, padding: "2rem", textAlign: "center" }}>
            <p style={{ fontSize: "0.875rem", color: "var(--color-accent)", marginBottom: "1rem" }}>{error}</p>
            <button onClick={() => router.push("/dashboard")} style={{ fontSize: "0.75rem", color: "var(--color-muted)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
              Go to dashboard
            </button>
          </div>
        ) : joined ? (
          <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, padding: "2rem", textAlign: "center" }}>
            <p style={{ fontSize: "1rem", fontWeight: 600, color: "var(--color-text)", marginBottom: "0.5rem" }}>You&apos;ve joined {preview?.organisationName}</p>
            <p style={{ fontSize: "0.8rem", color: "var(--color-muted)" }}>Redirecting to organisation settings…</p>
          </div>
        ) : preview ? (
          <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, padding: "2rem" }}>
            <p style={{ fontSize: "0.65rem", fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-muted)", marginBottom: "1rem" }}>
              Organisation Invite
            </p>
            <h1 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--color-text)", marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <span>{preview.organisationName}</span>
              <OrgTypeBadge type={preview.organisationType} />
            </h1>
            <p style={{ fontSize: "0.8rem", color: "var(--color-muted)", marginBottom: "1.5rem" }}>
              Invited: {preview.invitedEmail} · expires {new Date(preview.expiresAt * 1000).toLocaleDateString()}
            </p>
            <button
              onClick={() => void acceptInvite()}
              disabled={joining}
              style={{ width: "100%", padding: "0.65rem", fontSize: "0.875rem", fontWeight: 600, background: "var(--color-text)", color: "var(--color-bg)", border: "none", borderRadius: 5, cursor: "pointer" }}
            >
              {joining ? "Joining…" : `Join ${preview.organisationName}`}
            </button>
            {error && <p style={{ fontSize: "0.75rem", color: "var(--color-accent)", marginTop: "0.75rem" }}>{error}</p>}
          </div>
        ) : null}
      </div>
    </div>
  );
}

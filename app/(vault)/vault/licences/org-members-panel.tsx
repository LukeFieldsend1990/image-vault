"use client";

import { useState } from "react";
import OrgTypeBadge from "@/app/components/org-type-badge";
import CodeTag from "@/app/components/code-tag";

interface OrgMember {
  userId: string;
  email: string;
  memberRole: "owner" | "admin" | "member";
  joinedAt: number;
}

interface OrgDetail {
  id: string;
  name: string;
  website: string | null;
  billingEmail: string | null;
  orgType?: string | null;
  shortCode?: string | null;
}

interface Props {
  organisationId: string;
  submittedByUserId?: string | null;
}

export default function OrgMembersPanel({ organisationId, submittedByUserId }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);

  async function load() {
    if (org) { setOpen(o => !o); return; }
    setLoading(true);
    try {
      const r = await fetch(`/api/organisations/${organisationId}`);
      if (!r.ok) return;
      const d = await r.json() as { organisation?: OrgDetail; members?: OrgMember[] };
      setOrg(d.organisation ?? null);
      setMembers(d.members ?? []);
      setOpen(true);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ marginTop: "0.5rem" }}>
      <button
        onClick={() => void load()}
        style={{
          fontSize: "0.7rem",
          color: "var(--color-accent)",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
          textDecoration: "underline",
          textUnderlineOffset: 2,
        }}
      >
        {loading ? "Loading…" : open ? "Hide organisation members" : "View organisation members"}
      </button>

      {open && org && (
        <div style={{
          marginTop: "0.5rem",
          background: "var(--color-bg)",
          border: "1px solid var(--color-border)",
          borderRadius: 5,
          padding: "0.75rem",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.5rem" }}>
            <p style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--color-muted)", letterSpacing: "0.05em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <span>{org.name}</span>
              <OrgTypeBadge type={org.orgType} />
              <CodeTag code={org.shortCode} />
            </p>
            {org.website && (
              <a href={org.website} target="_blank" rel="noreferrer" style={{ fontSize: "0.65rem", color: "var(--color-muted)" }}>
                {org.website.replace(/^https?:\/\//, "")}
              </a>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            {members.map(m => (
              <div key={m.userId} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.8rem" }}>
                <span style={{ color: "var(--color-text)" }}>{m.email}</span>
                <span style={{ fontSize: "0.65rem", color: "var(--color-muted)", background: "var(--color-border)", padding: "1px 5px", borderRadius: 3 }}>
                  {m.memberRole}
                </span>
                {submittedByUserId === m.userId && (
                  <span style={{ fontSize: "0.65rem", color: "var(--color-accent)" }}>submitted</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

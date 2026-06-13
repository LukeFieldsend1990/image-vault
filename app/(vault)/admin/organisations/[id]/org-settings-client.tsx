"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ORG_TYPES, ORG_TYPE_LABELS, isVendorOrgType, type OrgType } from "@/lib/organisations/orgTypes";

interface Props {
  orgId: string;
  orgType: OrgType;
  vendorAuditPassed: boolean;
}

export default function OrgSettingsClient({ orgId, orgType: initialType, vendorAuditPassed: initialAudit }: Props) {
  const router = useRouter();
  const [orgType, setOrgType] = useState<OrgType>(initialType);
  const [auditPassed, setAuditPassed] = useState(initialAudit);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function patch(updates: { orgType?: OrgType; vendorAuditPassed?: boolean }) {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/organisations/${orgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        setErr(d.error ?? "Update failed.");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setErr("Update failed.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function onTypeChange(next: OrgType) {
    const prev = orgType;
    setOrgType(next);
    if (!(await patch({ orgType: next }))) setOrgType(prev);
  }

  async function onAuditToggle() {
    const next = !auditPassed;
    setAuditPassed(next);
    if (!(await patch({ vendorAuditPassed: next }))) setAuditPassed(!next);
  }

  const isVendor = isVendorOrgType(orgType);

  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>
        Type &amp; Audit
      </h2>
      <div className="rounded border divide-y" style={{ borderColor: "var(--color-border)" }}>
        {/* Org type */}
        <div className="flex items-center justify-between px-5 py-3 gap-4">
          <div>
            <p className="text-sm" style={{ color: "var(--color-ink)" }}>Organisation type</p>
            <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
              Drives surfaced workflows &amp; the chain-of-custody code prefix.
            </p>
          </div>
          <select
            value={orgType}
            disabled={saving}
            onChange={(e) => void onTypeChange(e.target.value as OrgType)}
            className="text-xs px-2 py-2 rounded border appearance-none cursor-pointer shrink-0"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-ink)" }}
          >
            {ORG_TYPES.map((t) => (
              <option key={t} value={t}>{ORG_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>

        {/* Vendor audit gate — only meaningful for mover/vendor orgs */}
        <div className="flex items-center justify-between px-5 py-3 gap-4">
          <div>
            <p className="text-sm" style={{ color: "var(--color-ink)" }}>Environment audit passed</p>
            <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
              {isVendor
                ? "Gates Bridge provisioning for this vendor. Toggle once the environment audit is cleared."
                : "Only applies to vendor orgs (VFX, dubbing, scan service)."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void onAuditToggle()}
            disabled={saving || !isVendor}
            aria-pressed={auditPassed}
            className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: auditPassed ? "var(--color-accent)" : "var(--color-border)" }}
          >
            <span
              className="inline-block h-5 w-5 rounded-full bg-white transition"
              style={{ transform: auditPassed ? "translateX(22px)" : "translateX(2px)" }}
            />
          </button>
        </div>
      </div>
      {err && <p className="text-xs mt-2" style={{ color: "var(--color-accent)" }}>{err}</p>}
    </section>
  );
}

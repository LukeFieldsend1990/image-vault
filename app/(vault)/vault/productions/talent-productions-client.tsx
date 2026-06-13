"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type LicenceStatus =
  | "AWAITING_PACKAGE" | "PENDING" | "APPROVED" | "DENIED"
  | "REVOKED" | "EXPIRED" | "SCRUB_PERIOD" | "CLOSED" | "OVERDUE";

interface Licence {
  id: string;
  projectName: string;
  productionCompany: string;
  productionId: string | null;
  status: LicenceStatus;
  licenceType: string | null;
  territory: string | null;
  exclusivity: string | null;
  packageName: string | null;
  validFrom: number;
  validTo: number;
  proposedFee: number | null;
  agreedFee: number | null;
  intendedUse: string;
  createdAt: number;
}

interface ProductionGroup {
  productionId: string;
  projectName: string;
  productionCompany: string;
  licences: Licence[];
}

const STATUS_ORDER: LicenceStatus[] = [
  "APPROVED", "PENDING", "AWAITING_PACKAGE", "SCRUB_PERIOD",
  "OVERDUE", "DENIED", "REVOKED", "EXPIRED", "CLOSED",
];

const ACTIVE_STATUSES: Set<LicenceStatus> = new Set([
  "APPROVED", "PENDING", "AWAITING_PACKAGE", "SCRUB_PERIOD", "OVERDUE",
]);

const TYPE_LABEL: Record<string, string> = {
  film_double: "Film / Double",
  game_character: "Game Character",
  commercial: "Commercial",
  ai_avatar: "AI Avatar",
  training_data: "AI Training",
  monitoring_reference: "Identity Reference",
};

const TYPE_CATEGORY: Record<string, string> = {
  film_double: "Feature Film",
  game_character: "Game",
  commercial: "Commercial",
  ai_avatar: "AI Production",
  training_data: "AI Training",
  monitoring_reference: "Security Reference",
};

const EXCLUSIVITY_LABEL: Record<string, string> = {
  non_exclusive: "Non-exclusive",
  sole: "Sole",
  exclusive: "Exclusive",
};

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function fmtMoney(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

function primaryLicence(licences: Licence[]): Licence {
  return [...licences].sort(
    (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
  )[0];
}

function StatusDot({ status }: { status: LicenceStatus }) {
  const isActive = ACTIVE_STATUSES.has(status);
  const isApproved = status === "APPROVED";
  if (isApproved) {
    return (
      <span className="flex items-center gap-1.5">
        <span className="relative flex h-2 w-2 flex-shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-50" style={{ background: "#16a34a" }} />
          <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: "#16a34a" }} />
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#16a34a" }}>Active</span>
      </span>
    );
  }
  if (isActive) {
    return (
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full flex-shrink-0" style={{ background: "#b45309" }} />
        <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#b45309" }}>{status.replace("_", " ")}</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-2 w-2 rounded-full flex-shrink-0" style={{ background: "#9ca3af" }} />
      <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#9ca3af" }}>{status.replace("_", " ")}</span>
    </span>
  );
}

function ProductionCard({ group }: { group: ProductionGroup }) {
  const [collapsed, setCollapsed] = useState(false);
  const primary = primaryLicence(group.licences);
  const isActive = ACTIVE_STATUSES.has(primary.status);
  const past = group.licences.filter(
    (l) => l.id !== primary.id && !ACTIVE_STATUSES.has(l.status)
  );
  const feeRef = primary.agreedFee ?? primary.proposedFee;
  const year = new Date(primary.validFrom * 1000).getFullYear();
  const category = primary.licenceType ? TYPE_CATEGORY[primary.licenceType] : null;

  return (
    <article
      className="rounded-lg overflow-hidden"
      style={{
        border: "1px solid var(--color-border)",
        background: "var(--color-surface)",
        opacity: isActive ? 1 : 0.65,
      }}
    >
      {/* Header band — click to collapse/expand */}
      <div
        className="px-6 pt-6 pb-5 cursor-pointer select-none"
        style={{ borderBottom: collapsed ? "none" : "1px solid var(--color-border)" }}
        onClick={() => setCollapsed((v) => !v)}
        role="button"
        aria-expanded={!collapsed}
      >
        {/* Eyebrow row */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            {category && (
              <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                {category}
              </span>
            )}
            {category && <span className="text-[10px]" style={{ color: "var(--color-border)" }}>·</span>}
            <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
              {year}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <StatusDot status={primary.status} />
            <svg
              width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{
                color: "var(--color-muted)",
                transform: collapsed ? "rotate(0deg)" : "rotate(180deg)",
                transition: "transform 0.2s",
              }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        </div>

        {/* Title + fee */}
        <div className="flex items-end justify-between gap-6">
          <div className="min-w-0">
            <h2 className="text-2xl font-semibold tracking-tight leading-none" style={{ color: "var(--color-ink)" }}>
              {group.projectName}
            </h2>
            <p className="mt-1.5 text-sm" style={{ color: "var(--color-muted)" }}>
              {group.productionCompany}
            </p>
          </div>
          {feeRef !== null && (
            <div className="text-right shrink-0">
              <p className="text-lg font-semibold tabular-nums" style={{ color: "var(--color-ink)" }}>
                {fmtMoney(feeRef)}
              </p>
              <p className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                {primary.agreedFee ? "Agreed fee" : "Proposed"}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Terms + details — hidden when collapsed */}
      {!collapsed && <div className="px-6 py-4">
        {/* Tags row */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {primary.licenceType && (
            <span
              className="inline-flex text-[10px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-sm"
              style={{ background: "rgba(192,57,43,0.08)", color: "var(--color-accent)" }}
            >
              {TYPE_LABEL[primary.licenceType] ?? primary.licenceType}
            </span>
          )}
          {primary.territory && (
            <span
              className="inline-flex text-[10px] font-medium px-2.5 py-1 rounded-sm"
              style={{ background: "var(--color-bg)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}
            >
              {primary.territory}
            </span>
          )}
          {primary.exclusivity && primary.exclusivity !== "non_exclusive" && (
            <span
              className="inline-flex text-[10px] font-medium px-2.5 py-1 rounded-sm"
              style={{ background: "var(--color-bg)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}
            >
              {EXCLUSIVITY_LABEL[primary.exclusivity] ?? primary.exclusivity}
            </span>
          )}
        </div>

        {/* Date range */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
            {fmtDate(primary.validFrom)}
          </span>
          <svg width="16" height="8" viewBox="0 0 16 8" fill="none" style={{ color: "var(--color-muted)" }}>
            <line x1="0" y1="4" x2="12" y2="4" stroke="currentColor" strokeWidth="1" />
            <polyline points="9,1 12,4 9,7" stroke="currentColor" strokeWidth="1" fill="none" />
          </svg>
          <span className="text-sm" style={{ color: "var(--color-muted)" }}>
            {fmtDate(primary.validTo)}
          </span>
        </div>

        {/* Intended use */}
        {primary.intendedUse && (
          <p className="text-xs mb-4" style={{ color: "var(--color-muted)" }}>
            <span className="font-medium" style={{ color: "var(--color-text)" }}>Usage: </span>
            {primary.intendedUse}
          </p>
        )}

        {/* No scan notice */}
        {primary.status === "APPROVED" && !primary.packageName && (
          <div
            className="flex items-center justify-between gap-3 rounded px-4 py-3 mb-4"
            style={{ background: "rgba(180,83,9,0.06)", border: "1px solid rgba(180,83,9,0.2)" }}
          >
            <p className="text-xs" style={{ color: "#b45309" }}>
              No scan package attached — you may be scanned as part of production.
            </p>
            <Link
              href={`/vault/licences?highlight=${primary.id}`}
              className="text-xs font-semibold whitespace-nowrap"
              style={{ color: "#b45309" }}
            >
              Attach scan →
            </Link>
          </div>
        )}

        {/* CTA */}
        <div className="flex items-center justify-end">
          <Link
            href={`/vault/licences?highlight=${primary.id}`}
            className="text-xs font-semibold tracking-wide hover:opacity-70 transition-opacity"
            style={{ color: "var(--color-accent)" }}
          >
            View licence agreement →
          </Link>
        </div>
      </div>}

      {/* Past agreements */}
      {!collapsed && past.length > 0 && (
        <div
          className="px-6 py-3"
          style={{ borderTop: "1px solid var(--color-border)", background: "var(--color-bg)" }}
        >
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: "var(--color-muted)" }}>
            Previous Agreements
          </p>
          <div className="space-y-1.5">
            {past.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span
                    className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
                    style={{ background: "var(--color-border)", color: "var(--color-muted)" }}
                  >
                    {l.status}
                  </span>
                  <span className="text-[11px]" style={{ color: "var(--color-muted)" }}>
                    {fmtDate(l.validFrom)} – {fmtDate(l.validTo)}
                  </span>
                </div>
                <Link
                  href={`/vault/licences?highlight=${l.id}`}
                  className="text-[11px] font-medium"
                  style={{ color: "var(--color-muted)" }}
                >
                  View →
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

export default function TalentProductionsClient({ talentId }: { talentId?: string }) {
  const [groups, setGroups] = useState<ProductionGroup[]>([]);
  const [loading, setLoading] = useState(true);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    fetch(talentId ? `/api/licences?talentId=${encodeURIComponent(talentId)}` : "/api/licences")
      .then((r) => r.json())
      .then((d) => {
        const data = d as { licences?: Licence[] };
        const production = (data.licences ?? []).filter((l) => l.productionId !== null);

        const map = new Map<string, ProductionGroup>();
        for (const l of production) {
          const pid = l.productionId!;
          if (!map.has(pid)) {
            map.set(pid, {
              productionId: pid,
              projectName: l.projectName,
              productionCompany: l.productionCompany,
              licences: [],
            });
          }
          map.get(pid)!.licences.push(l);
        }

        // Sort: active productions first
        const sorted = Array.from(map.values()).sort((a, b) => {
          const aActive = ACTIVE_STATUSES.has(primaryLicence(a.licences).status) ? 0 : 1;
          const bActive = ACTIVE_STATUSES.has(primaryLicence(b.licences).status) ? 0 : 1;
          return aActive - bActive;
        });

        setGroups(sorted);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [talentId]);

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-10">
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>
          Vault
        </p>
        <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
          My Productions
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
          Productions you&apos;ve been engaged on and the licences governing your likeness.
        </p>
      </div>

      {loading && (
        <div className="space-y-4">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="rounded-lg animate-pulse"
              style={{ height: 220, background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
            />
          ))}
        </div>
      )}

      {!loading && groups.length === 0 && (
        <div
          className="rounded-lg px-8 py-12 text-center"
          style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
        >
          <p className="text-sm font-medium mb-1" style={{ color: "var(--color-text)" }}>
            No production engagements yet
          </p>
          <p className="text-xs" style={{ color: "var(--color-muted)" }}>
            When a production company adds you to their cast and you accept, it will appear here.
          </p>
        </div>
      )}

      <div className="space-y-5">
        {groups.map((group) => (
          <ProductionCard key={group.productionId} group={group} />
        ))}
      </div>
    </div>
  );
}

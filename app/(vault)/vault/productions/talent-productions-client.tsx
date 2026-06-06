"use client";

import { useEffect, useState } from "react";

type LicenceStatus =
  | "AWAITING_PACKAGE"
  | "PENDING"
  | "APPROVED"
  | "DENIED"
  | "REVOKED"
  | "EXPIRED"
  | "SCRUB_PERIOD"
  | "CLOSED"
  | "OVERDUE";

interface LicenceType {
  id: string;
  projectName: string;
  productionCompany: string;
  productionId: string | null;
  status: LicenceStatus;
  licenceType: string | null;
  territory: string | null;
  packageName: string | null;
  validFrom: number;
  validTo: number;
  proposedFee: number | null;
  agreedFee: number | null;
  createdAt: number;
}

interface ProductionGroup {
  productionId: string;
  projectName: string;
  productionCompany: string;
  licences: LicenceType[];
}

const STATUS_COLOURS: Record<LicenceStatus, string> = {
  AWAITING_PACKAGE: "#7c3aed",
  PENDING: "#b45309",
  APPROVED: "#166534",
  DENIED: "#991b1b",
  REVOKED: "#6b7280",
  EXPIRED: "#6b7280",
  SCRUB_PERIOD: "#c0392b",
  CLOSED: "#374151",
  OVERDUE: "#991b1b",
};

const LICENCE_TYPE_LABELS: Record<string, string> = {
  film_double: "Film / Double",
  game_character: "Game Character",
  commercial: "Commercial / Advertising",
  ai_avatar: "AI Avatar / Virtual Self",
  training_data: "AI Training Data",
  monitoring_reference: "Identity / Security Reference",
};

function formatDate(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function TalentProductionsClient() {
  const [groups, setGroups] = useState<ProductionGroup[]>([]);
  const [loading, setLoading] = useState(true);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    fetch("/api/licences")
      .then((r) => r.json())
      .then((d) => {
        const data = d as { licences?: LicenceType[] };
        const all = (data.licences ?? []).filter((l) => l.productionId !== null);

        // Group by productionId
        const map = new Map<string, ProductionGroup>();
        for (const l of all) {
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

        setGroups(Array.from(map.values()));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
          My Productions
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
          Productions you&apos;ve been cast in.
        </p>
      </div>

      {loading && (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>Loading…</p>
      )}

      {!loading && groups.length === 0 && (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          You haven&apos;t been added to any productions yet.
        </p>
      )}

      <div className="space-y-4">
        {groups.map((group) => (
          <div
            key={group.productionId}
            className="rounded border p-5"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <div className="mb-3">
              <p className="font-medium text-sm" style={{ color: "var(--color-ink)" }}>
                {group.projectName}
              </p>
              <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
                {group.productionCompany}
              </p>
            </div>

            <div className="space-y-2">
              {group.licences.map((l) => (
                <div
                  key={l.id}
                  className="rounded border p-3 text-xs"
                  style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
                >
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                      style={{
                        background: `${STATUS_COLOURS[l.status]}18`,
                        color: STATUS_COLOURS[l.status],
                      }}
                    >
                      {l.status}
                    </span>
                    {l.licenceType && (
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                        style={{ background: "var(--color-border)", color: "var(--color-muted)" }}
                      >
                        {LICENCE_TYPE_LABELS[l.licenceType] ?? l.licenceType}
                      </span>
                    )}
                  </div>
                  <p style={{ color: "var(--color-muted)" }}>
                    {formatDate(l.validFrom)} – {formatDate(l.validTo)}
                  </p>
                  {l.status === "APPROVED" && !l.packageName && (
                    <p className="mt-1 font-medium" style={{ color: "#b45309" }}>
                      No scan attached
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

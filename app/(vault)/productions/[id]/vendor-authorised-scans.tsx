"use client";

import { useEffect, useState } from "react";

interface Scan {
  licenceId: string;
  talentName: string | null;
  packageName: string | null;
  licenceType: string | null;
  validFrom: number;
  validTo: number;
  status: string;
}

// The scans the vendor's org has been authorised to pull on this production.
// Read-only: the production grants access per licence; the vendor pulls via the
// Render Bridge once their environment audit passes.
export default function VendorAuthorisedScans({ productionId }: { productionId: string }) {
  const [scans, setScans] = useState<Scan[]>([]);
  const [auditPassed, setAuditPassed] = useState(true);
  const [loaded, setLoaded] = useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    fetch(`/api/productions/${productionId}/vendor-access`)
      .then((r) => r.json() as Promise<{ scans?: Scan[]; auditPassed?: boolean }>)
      .then((d) => { setScans(d.scans ?? []); setAuditPassed(d.auditPassed ?? false); })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [productionId]);

  if (!loaded) return null;

  return (
    <div className="rounded p-5" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}>
      <p className="text-xs font-medium tracking-widest uppercase mb-3" style={{ color: "var(--color-muted)" }}>
        Authorised scans · {scans.length}
      </p>

      {scans.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          No scans authorised for your facility on this production yet. The production company grants access per licence — once they do, the scan appears here and your render-bridge agents can pull it.
        </p>
      ) : (
        <>
          {!auditPassed && (
            <p className="text-xs mb-3 rounded px-3 py-2" style={{ background: "rgba(180,83,9,0.08)", color: "#b45309" }}>
              Your facility&apos;s environment audit hasn&apos;t passed yet — the Render Bridge won&apos;t serve these scans until it does.
            </p>
          )}
          <div className="rounded overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
            {scans.map((s, i) => (
              <div
                key={s.licenceId}
                className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
                style={{ borderBottom: i < scans.length - 1 ? "1px solid var(--color-border)" : "none", background: "var(--color-bg)" }}
              >
                <div className="min-w-0">
                  <span className="font-medium" style={{ color: "var(--color-text)" }}>{s.talentName ?? "—"}</span>
                  {s.packageName && <span className="text-xs ml-2" style={{ color: "var(--color-muted)" }}>{s.packageName}</span>}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {s.licenceType && <span className="text-xs" style={{ color: "var(--color-muted)" }}>{s.licenceType.replace(/_/g, " ")}</span>}
                  <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                    until {new Date(s.validTo * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

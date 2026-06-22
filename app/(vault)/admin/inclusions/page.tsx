import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getDb } from "@/lib/db";
import { productionInclusionRecords, licences, users, productions } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import ReviewButton from "./review-button";

function ts(unix: number): string {
  return new Date(unix * 1000).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// Admin review queue for production-included claims. Flagged claims (prior usage
// found) surface here so an admin can decide whether to act. We never block the
// inclusion itself — this is for our records and follow-up.
export default async function AdminInclusionsPage() {
  await requireAdmin();
  const db = getDb();

  const rows = await db
    .select({
      id: productionInclusionRecords.id,
      licenceId: productionInclusionRecords.licenceId,
      markedAt: productionInclusionRecords.markedAt,
      reason: productionInclusionRecords.reason,
      priorLicenceCount: productionInclusionRecords.priorLicenceCount,
      priorDownloadCount: productionInclusionRecords.priorDownloadCount,
      flagged: productionInclusionRecords.flagged,
      reviewedAt: productionInclusionRecords.reviewedAt,
      reviewNote: productionInclusionRecords.reviewNote,
      licenceCode: licences.shortCode,
      projectName: licences.projectName,
      markedByEmail: users.email,
      productionName: productions.name,
    })
    .from(productionInclusionRecords)
    .leftJoin(licences, eq(licences.id, productionInclusionRecords.licenceId))
    .leftJoin(users, eq(users.id, productionInclusionRecords.markedBy))
    .leftJoin(productions, eq(productions.id, productionInclusionRecords.productionId))
    .orderBy(desc(productionInclusionRecords.flagged), desc(productionInclusionRecords.markedAt))
    .all();

  const flaggedOpen = rows.filter((r) => r.flagged && !r.reviewedAt).length;

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-8">
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>Admin</p>
        <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>Production-included claims</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
          Zero-fee licences claimed as part of a production. {flaggedOpen > 0 ? `${flaggedOpen} flagged for review.` : "Nothing awaiting review."}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm rounded px-4 py-6 text-center" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-muted)" }}>
          No production-included claims yet.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const reviewed = !!r.reviewedAt;
            return (
              <div
                key={r.id}
                className="rounded border px-5 py-4"
                style={{
                  borderColor: r.flagged && !reviewed ? "var(--color-accent)" : "var(--color-border)",
                  background: r.flagged && !reviewed ? "color-mix(in srgb, var(--color-accent) 5%, var(--color-bg))" : "var(--color-surface)",
                }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
                        {r.projectName ?? "—"}
                      </span>
                      <span className="text-xs font-mono" style={{ color: "var(--color-muted)" }}>{r.licenceCode ?? r.licenceId.slice(0, 8)}</span>
                      {r.flagged ? (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded" style={{ background: "rgba(192,57,43,0.1)", color: "var(--color-accent)" }}>Flagged</span>
                      ) : (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded" style={{ background: "rgba(22,101,52,0.1)", color: "#166534" }}>Clean</span>
                      )}
                      {reviewed && <span className="text-[10px] font-semibold px-2 py-0.5 rounded" style={{ background: "var(--color-bg)", color: "var(--color-muted)" }}>Reviewed</span>}
                    </div>
                    <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                      Marked by {r.markedByEmail ?? "—"} · {ts(r.markedAt)}
                    </p>
                    {r.reason && <p className="text-xs mt-1" style={{ color: "var(--color-text)" }}>“{r.reason}”</p>}
                    {r.flagged && (
                      <p className="text-xs mt-2" style={{ color: "var(--color-accent)" }}>
                        Prior usage: {r.priorLicenceCount} licence(s), {r.priorDownloadCount} download(s)
                      </p>
                    )}
                    {reviewed && r.reviewNote && <p className="text-xs mt-2" style={{ color: "var(--color-muted)" }}>Review: {r.reviewNote}</p>}
                  </div>
                  {r.flagged && !reviewed && <ReviewButton recordId={r.id} />}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

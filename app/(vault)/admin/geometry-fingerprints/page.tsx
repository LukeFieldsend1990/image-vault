export const runtime = "edge";

import Link from "next/link";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getDb } from "@/lib/db";
import {
  geometryFingerprints,
  geometryFingerprintJobs,
  scanPackages,
  users,
} from "@/lib/db/schema";
import { sql, eq, inArray } from "drizzle-orm";
import GeoFingerprintDetectClient from "./page-client";

function ts(unix: number): string {
  return new Date(unix * 1000).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function GeoFingerprintsAdminPage() {
  await requireAdmin();
  const db = getDb();

  const [totalFps, readyFps, pendingJobs, recentJobs, packages] = await Promise.all([
    db.select({ n: sql<number>`count(*)` }).from(geometryFingerprints).get(),
    db
      .select({ n: sql<number>`count(*)` })
      .from(geometryFingerprints)
      .where(eq(geometryFingerprints.status, "ready"))
      .get(),
    db
      .select({ n: sql<number>`count(*)` })
      .from(geometryFingerprintJobs)
      .where(sql`status in ('queued','processing')`)
      .get(),
    db
      .select({
        id: geometryFingerprintJobs.id,
        licenceId: geometryFingerprintJobs.licenceId,
        status: geometryFingerprintJobs.status,
        filesTotal: geometryFingerprintJobs.filesTotal,
        filesDone: geometryFingerprintJobs.filesDone,
        createdAt: geometryFingerprintJobs.createdAt,
      })
      .from(geometryFingerprintJobs)
      .orderBy(sql`created_at desc`)
      .limit(10)
      .all(),
    db
      .select({
        id: scanPackages.id,
        name: scanPackages.name,
        talentId: scanPackages.talentId,
      })
      .from(scanPackages)
      .where(sql`deleted_at is null`)
      .orderBy(sql`created_at desc`)
      .all(),
  ]);

  // Resolve talent emails for packages
  const talentIds = [...new Set(packages.map((p) => p.talentId))];
  const talentUsers =
    talentIds.length > 0
      ? await db
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(inArray(users.id, talentIds))
          .all()
      : [];
  const emailMap = new Map(talentUsers.map((u) => [u.id, u.email]));

  const packageOptions = packages.map((p) => ({
    id: p.id,
    name: p.name,
    talentEmail: emailMap.get(p.talentId) ?? p.talentId.slice(0, 8) + "…",
  }));

  const JOB_STATUS_COLOR: Record<string, string> = {
    queued: "#d97706",
    processing: "#2563eb",
    complete: "#166534",
    failed: "#991b1b",
  };

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <Link
            href="/admin"
            className="text-xs"
            style={{ color: "var(--color-muted)" }}
          >
            Admin
          </Link>
          <span className="text-xs" style={{ color: "var(--color-muted)" }}>
            /
          </span>
          <span
            className="text-[9px] uppercase tracking-[0.2em] font-semibold px-2 py-0.5 rounded"
            style={{ background: "rgba(192,57,43,0.12)", color: "var(--color-accent)" }}
          >
            Forensics
          </span>
        </div>
        <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>
          Geometric Fingerprinting
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          Invisible licence attribution signals embedded in OBJ geometry. Used to identify the
          source of unauthorised redistribution.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: "Fingerprints Issued", value: String(readyFps?.n ?? 0), sub: `${totalFps?.n ?? 0} total incl. failed` },
          { label: "Pending Jobs", value: String(pendingJobs?.n ?? 0), sub: "queued or processing" },
          { label: "Packages", value: String(packages.length), sub: "available to check" },
        ].map((c) => (
          <div
            key={c.label}
            className="rounded border p-5"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <p
              className="text-[10px] uppercase tracking-widest font-medium mb-2"
              style={{ color: "var(--color-muted)" }}
            >
              {c.label}
            </p>
            <p className="text-2xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
              {c.value}
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--color-muted)" }}>
              {c.sub}
            </p>
          </div>
        ))}
      </div>

      {/* Detection tool */}
      <GeoFingerprintDetectClient packages={packageOptions} />

      {/* Recent jobs */}
      <div className="rounded border mt-8" style={{ borderColor: "var(--color-border)" }}>
        <div
          className="px-5 py-3.5 border-b"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <h2
            className="text-xs font-semibold uppercase tracking-widest"
            style={{ color: "var(--color-muted)" }}
          >
            Recent Watermark Jobs
          </h2>
        </div>
        {recentJobs.length === 0 ? (
          <p className="px-5 py-4 text-xs" style={{ color: "var(--color-muted)" }}>
            No jobs yet. Jobs are created automatically when a licence is approved.
          </p>
        ) : (
          recentJobs.map((job) => (
            <div
              key={job.id}
              className="px-5 py-3 border-b last:border-0 flex items-center justify-between gap-4"
              style={{ borderColor: "var(--color-border)" }}
            >
              <div className="min-w-0">
                <p className="text-xs font-medium truncate" style={{ color: "var(--color-ink)" }}>
                  {job.licenceId}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: "var(--color-muted)" }}>
                  {ts(job.createdAt)} · {job.filesDone}/{job.filesTotal ?? "?"} files
                </p>
              </div>
              <span
                className="text-[9px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded shrink-0"
                style={{
                  background: `${JOB_STATUS_COLOR[job.status] ?? "#6b7280"}18`,
                  color: JOB_STATUS_COLOR[job.status] ?? "#6b7280",
                }}
              >
                {job.status}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Legal notice */}
      <p className="text-xs mt-8" style={{ color: "var(--color-muted)" }}>
        Downloaded geometry may contain invisible licence attribution signals used to identify the
        source of unauthorised redistribution. This provides technical evidence for investigation
        and enforcement — not absolute legal proof. Results should be described as{" "}
        <em>likely source</em> or <em>confidence-ranked attribution</em>.
      </p>
    </div>
  );
}

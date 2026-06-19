import Link from "next/link";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getDb } from "@/lib/db";
import {
  geometryFingerprints,
  geometryFingerprintJobs,
  scanPackages,
  scanFiles,
  licences,
  users,
} from "@/lib/db/schema";
import { sql, eq, inArray } from "drizzle-orm";
import GeoFingerprintDetectClient from "./page-client";
import GeoFingerprintJobsTable, { type JobRow, type FingerprintFileRow } from "./jobs-table";

export default async function GeoFingerprintsAdminPage() {
  await requireAdmin();
  const db = getDb();

  const [totalFps, readyFps, pendingJobs, rawJobs, packages] = await Promise.all([
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
        packageId: geometryFingerprintJobs.packageId,
        status: geometryFingerprintJobs.status,
        filesTotal: geometryFingerprintJobs.filesTotal,
        filesDone: geometryFingerprintJobs.filesDone,
        error: geometryFingerprintJobs.error,
        createdAt: geometryFingerprintJobs.createdAt,
        completedAt: geometryFingerprintJobs.completedAt,
      })
      .from(geometryFingerprintJobs)
      .orderBy(sql`created_at desc`)
      .limit(25)
      .all(),
    db
      .select({ id: scanPackages.id, name: scanPackages.name, talentId: scanPackages.talentId })
      .from(scanPackages)
      .where(sql`deleted_at is null`)
      .orderBy(sql`created_at desc`)
      .all(),
  ]);

  // Resolve package names + licensee emails for jobs
  const jobPackageIds = [...new Set(rawJobs.map((j) => j.packageId))];
  const jobLicenceIds = [...new Set(rawJobs.map((j) => j.licenceId))];
  const jobIds = rawJobs.map((j) => j.id);

  const [jobPackageRows, jobLicenceRows, fpRows] = await Promise.all([
    jobPackageIds.length > 0
      ? db
          .select({ id: scanPackages.id, name: scanPackages.name })
          .from(scanPackages)
          .where(inArray(scanPackages.id, jobPackageIds))
          .all()
      : Promise.resolve([] as { id: string; name: string }[]),
    jobLicenceIds.length > 0
      ? db
          .select({ id: licences.id, licenseeId: licences.licenseeId })
          .from(licences)
          .where(inArray(licences.id, jobLicenceIds))
          .all()
      : Promise.resolve([] as { id: string; licenseeId: string }[]),
    jobIds.length > 0
      ? db
          .select({
            id: geometryFingerprints.id,
            jobId: geometryFingerprints.jobId,
            fileId: geometryFingerprints.fileId,
            status: geometryFingerprints.status,
            error: geometryFingerprints.error,
            createdAt: geometryFingerprints.createdAt,
          })
          .from(geometryFingerprints)
          .where(inArray(geometryFingerprints.jobId, jobIds))
          .orderBy(sql`created_at asc`)
          .all()
      : Promise.resolve(
          [] as {
            id: string;
            jobId: string;
            fileId: string;
            status: string;
            error: string | null;
            createdAt: number;
          }[]
        ),
  ]);

  // Resolve licensee emails
  const licenseeIds = [...new Set(jobLicenceRows.map((l) => l.licenseeId))];
  const licenseeUsers =
    licenseeIds.length > 0
      ? await db
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(inArray(users.id, licenseeIds))
          .all()
      : [];

  // Resolve scan file names for fingerprint rows
  const fpFileIds = [...new Set(fpRows.map((f) => f.fileId))];
  const fpFileRows =
    fpFileIds.length > 0
      ? await db
          .select({ id: scanFiles.id, filename: scanFiles.filename })
          .from(scanFiles)
          .where(inArray(scanFiles.id, fpFileIds))
          .all()
      : [];

  // Build lookup maps
  const pkgNameMap = new Map(jobPackageRows.map((p) => [p.id, p.name]));
  const licenceLicenseeMap = new Map(jobLicenceRows.map((l) => [l.id, l.licenseeId]));
  const userEmailMap = new Map(licenseeUsers.map((u) => [u.id, u.email]));
  const fileNameMap = new Map(fpFileRows.map((f) => [f.id, f.filename]));

  // Group fingerprints by jobId
  const fpByJob = new Map<string, FingerprintFileRow[]>();
  for (const fp of fpRows) {
    if (!fpByJob.has(fp.jobId)) fpByJob.set(fp.jobId, []);
    fpByJob.get(fp.jobId)!.push({
      id: fp.id,
      fileId: fp.fileId,
      filename: fileNameMap.get(fp.fileId) ?? fp.fileId.slice(0, 8) + "…",
      status: fp.status,
      error: fp.error,
      createdAt: fp.createdAt,
    });
  }

  // Build final JobRow[]
  // eslint-disable-next-line react-hooks/purity -- server component, Date.now() is fine here
  const nowSecs = Math.floor(Date.now() / 1000);

  const jobs: JobRow[] = rawJobs.map((j) => {
    const licenseeId = licenceLicenseeMap.get(j.licenceId) ?? "";
    return {
      id: j.id,
      licenceId: j.licenceId,
      licenseeEmail: userEmailMap.get(licenseeId) ?? licenseeId.slice(0, 8) + "…",
      packageName: pkgNameMap.get(j.packageId) ?? j.packageId.slice(0, 8) + "…",
      status: j.status,
      filesTotal: j.filesTotal,
      filesDone: j.filesDone,
      error: j.error,
      createdAt: j.createdAt,
      completedAt: j.completedAt,
      fingerprints: fpByJob.get(j.id) ?? [],
    };
  });

  // Resolve talent emails for packages dropdown
  const talentIds = [...new Set(packages.map((p) => p.talentId))];
  const talentUsers =
    talentIds.length > 0
      ? await db
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(inArray(users.id, talentIds))
          .all()
      : [];
  const talentEmailMap = new Map(talentUsers.map((u) => [u.id, u.email]));

  const packageOptions = packages.map((p) => ({
    id: p.id,
    name: p.name,
    talentEmail: talentEmailMap.get(p.talentId) ?? p.talentId.slice(0, 8) + "…",
  }));

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <Link href="/admin" className="text-xs" style={{ color: "var(--color-muted)" }}>
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
          {
            label: "Fingerprints Issued",
            value: String(readyFps?.n ?? 0),
            sub: `${totalFps?.n ?? 0} total incl. failed`,
          },
          {
            label: "Pending Jobs",
            value: String(pendingJobs?.n ?? 0),
            sub: "queued or processing",
          },
          {
            label: "Packages",
            value: String(packages.length),
            sub: "available to check",
          },
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
            <p
              className="text-2xl font-semibold tracking-tight"
              style={{ color: "var(--color-ink)" }}
            >
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

      {/* Job log */}
      <div
        className="rounded border mt-8"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div
          className="px-5 py-3.5 border-b flex items-center justify-between"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <h2
            className="text-xs font-semibold uppercase tracking-widest"
            style={{ color: "var(--color-muted)" }}
          >
            Watermark Jobs
          </h2>
          <span className="text-[11px]" style={{ color: "var(--color-muted)" }}>
            {jobs.length} most recent · click row to expand files
          </span>
        </div>
        <GeoFingerprintJobsTable jobs={jobs} nowSecs={nowSecs} />
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

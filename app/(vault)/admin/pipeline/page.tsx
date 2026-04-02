export const runtime = "edge";

import Link from "next/link";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getDb } from "@/lib/db";
import { pipelineJobs, pipelineStages, scanPackages, users } from "@/lib/db/schema";
import { sql, eq } from "drizzle-orm";

function ts(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

const STATUS_COLOR: Record<string, string> = {
  queued: "#d97706",
  processing: "#2563eb",
  complete: "#166534",
  failed: "#991b1b",
  cancelled: "#6b7280",
};

function fmtDuration(a: number | null, b: number | null): string {
  if (!a || !b) return "—";
  const secs = b - a;
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

export default async function AdminPipelinePage() {
  await requireAdmin();
  const db = getDb();

  const jobs = await db
    .select({
      id: pipelineJobs.id,
      status: pipelineJobs.status,
      skus: pipelineJobs.skus,
      createdAt: pipelineJobs.createdAt,
      startedAt: pipelineJobs.startedAt,
      completedAt: pipelineJobs.completedAt,
      error: pipelineJobs.error,
      packageName: scanPackages.name,
      talentEmail: users.email,
    })
    .from(pipelineJobs)
    .innerJoin(scanPackages, eq(scanPackages.id, pipelineJobs.packageId))
    .innerJoin(users, eq(users.id, pipelineJobs.talentId))
    .orderBy(sql`${pipelineJobs.createdAt} desc`)
    .all();

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>Admin</p>
        <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>Pipeline Jobs</h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          {jobs.length} job{jobs.length !== 1 ? "s" : ""} total
        </p>
      </div>

      <p className="text-[10px] text-right sm:hidden mb-1" style={{ color: "var(--color-muted)" }}>Scroll for more →</p>
      <div className="rounded border overflow-x-auto" style={{ borderColor: "var(--color-border)" }}>
        {/* Header */}
        <div
          className="grid text-[10px] uppercase tracking-widest font-semibold px-5 py-3 min-w-[800px]"
          style={{
            gridTemplateColumns: "2fr 1.5fr 1fr 1fr 1fr 1fr",
            color: "var(--color-muted)",
            background: "var(--color-surface)",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <span>Package</span>
          <span>Talent</span>
          <span>SKUs</span>
          <span>Status</span>
          <span>Duration</span>
          <span>Created</span>
        </div>

        {jobs.length === 0 && (
          <p className="px-5 py-6 text-sm" style={{ color: "var(--color-muted)" }}>No pipeline jobs yet.</p>
        )}

        {jobs.map((job) => {
          const color = STATUS_COLOR[job.status] ?? "#6b7280";
          const skus = JSON.parse(job.skus) as string[];
          return (
            <div key={job.id} className="grid items-center px-5 py-3.5 text-sm border-b last:border-0 min-w-[800px]" style={{
              gridTemplateColumns: "2fr 1.5fr 1fr 1fr 1fr 1fr",
              borderColor: "var(--color-border)",
            }}>
              <div className="min-w-0">
                <p className="font-medium truncate" style={{ color: "var(--color-ink)" }}>{job.packageName}</p>
                <Link
                  href={`/vault/pipeline/jobs/${job.id}`}
                  className="text-[10px] mt-0.5 inline-block"
                  style={{ color: "var(--color-accent)" }}
                >
                  View job →
                </Link>
              </div>

              <span className="text-xs truncate" style={{ color: "var(--color-muted)" }}>
                {job.talentEmail}
              </span>

              <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                {skus.join(", ")}
              </span>

              <span
                className="inline-flex items-center text-[9px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded w-fit"
                style={{ background: `${color}18`, color }}
              >
                {job.status}
              </span>

              <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                {fmtDuration(job.startedAt, job.completedAt)}
              </span>

              <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                {ts(job.createdAt)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

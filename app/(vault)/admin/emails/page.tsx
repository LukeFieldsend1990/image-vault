import Link from "next/link";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getDb } from "@/lib/db";
import { emailLog } from "@/lib/db/schema";
import { sql, desc } from "drizzle-orm";

function ts(unix: number): string {
  return new Date(unix * 1000).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default async function AdminEmailsPage() {
  await requireAdmin();
  const db = getDb();

  const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 86400;

  const [statusCounts, recentFailures] = await Promise.all([
    db
      .select({
        status: emailLog.status,
        count: sql<number>`count(*)`,
      })
      .from(emailLog)
      .where(sql`sent_at >= ${sevenDaysAgo}`)
      .groupBy(emailLog.status)
      .all(),

    db
      .select({
        id: emailLog.id,
        toAddress: emailLog.toAddress,
        subject: emailLog.subject,
        errorCode: emailLog.errorCode,
        errorBody: emailLog.errorBody,
        sentAt: emailLog.sentAt,
      })
      .from(emailLog)
      .where(sql`status = 'failed' AND sent_at >= ${sevenDaysAgo}`)
      .orderBy(desc(emailLog.sentAt))
      .limit(50)
      .all(),
  ]);

  const countMap = Object.fromEntries(statusCounts.map((r) => [r.status, r.count]));
  const totalSent = (countMap["sent"] ?? 0) + (countMap["failed"] ?? 0);
  const failedCount = countMap["failed"] ?? 0;

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <Link href="/admin" className="text-xs mb-3 inline-block" style={{ color: "var(--color-accent)" }}>
          &larr; Admin overview
        </Link>
        <div className="flex items-center gap-2 mb-1">
          <span
            className="text-[9px] uppercase tracking-[0.2em] font-semibold px-2 py-0.5 rounded"
            style={{ background: "rgba(192,57,43,0.12)", color: "var(--color-accent)" }}
          >
            Admin
          </span>
        </div>
        <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>Outbound Email Log</h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          Failed user-facing emails in the last 7 days.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        <div className="rounded border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
          <p className="text-[10px] uppercase tracking-widest font-medium mb-1" style={{ color: "var(--color-muted)" }}>
            Attempted (7d)
          </p>
          <p className="text-2xl font-semibold" style={{ color: "var(--color-ink)" }}>{totalSent}</p>
        </div>
        <div className="rounded border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
          <p className="text-[10px] uppercase tracking-widest font-medium mb-1" style={{ color: "var(--color-muted)" }}>
            Delivered (7d)
          </p>
          <p className="text-2xl font-semibold" style={{ color: "#16a34a" }}>{countMap["sent"] ?? 0}</p>
        </div>
        <div className="rounded border p-4" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
          <p className="text-[10px] uppercase tracking-widest font-medium mb-1" style={{ color: "var(--color-muted)" }}>
            Failed (7d)
          </p>
          <p className="text-2xl font-semibold" style={{ color: failedCount > 0 ? "#dc2626" : "var(--color-ink)" }}>
            {failedCount}
          </p>
        </div>
      </div>

      {/* Failed emails table */}
      <div className="rounded border" style={{ borderColor: "var(--color-border)" }}>
        <div
          className="px-5 py-3.5 border-b flex items-center justify-between"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
            Failed Sends (7d)
          </h2>
          {failedCount > 0 && (
            <span className="text-xs px-2 py-0.5 rounded" style={{ background: "#dc262618", color: "#dc2626" }}>
              {failedCount}
            </span>
          )}
        </div>

        {recentFailures.length === 0 ? (
          <p className="px-5 py-4 text-xs" style={{ color: "var(--color-muted)" }}>
            No failed emails in the last 7 days.
          </p>
        ) : (
          recentFailures.map((row) => (
            <div
              key={row.id}
              className="px-5 py-3.5 border-b last:border-0"
              style={{ borderColor: "var(--color-border)" }}
            >
              <div className="flex items-start justify-between gap-4 mb-1">
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate" style={{ color: "var(--color-ink)" }}>
                    {row.subject}
                  </p>
                  <p className="text-[11px] mt-0.5" style={{ color: "var(--color-muted)" }}>
                    To: {row.toAddress}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {row.errorCode != null && (
                    <span
                      className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                      style={{ background: "#dc262618", color: "#dc2626" }}
                    >
                      {row.errorCode}
                    </span>
                  )}
                  <span className="text-[10px]" style={{ color: "var(--color-muted)" }}>
                    {ts(row.sentAt)}
                  </span>
                </div>
              </div>
              {row.errorBody && (
                <p
                  className="text-[11px] mt-1.5 rounded px-2 py-1 font-mono break-all"
                  style={{ background: "#dc262610", color: "#dc2626" }}
                >
                  {row.errorBody}
                </p>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

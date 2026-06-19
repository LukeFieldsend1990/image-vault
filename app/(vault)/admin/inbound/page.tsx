import Link from "next/link";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getDb } from "@/lib/db";
import { receivedEmails, aiTriageResults, aiCostLog } from "@/lib/db/schema";
import { sql, desc } from "drizzle-orm";

function ts(unix: number): string {
  return new Date(unix * 1000).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

const STATUS_COLOR: Record<string, { bg: string; text: string }> = {
  triaged:    { bg: "#16a34a18", text: "#16a34a" },
  failed:     { bg: "#dc262618", text: "#dc2626" },
  processing: { bg: "#d9770618", text: "#d97706" },
  pending:    { bg: "#e5e5e518", text: "#6b7280" },
  fetching:   { bg: "#2563eb18", text: "#2563eb" },
};

export default async function AdminInboundPage() {
  await requireAdmin();
  const db = getDb();

  const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 86400;

  const [statusCounts, stuckEmails, recentTriageLogs] = await Promise.all([
    db
      .select({
        status: receivedEmails.processingStatus,
        count: sql<number>`count(*)`,
      })
      .from(receivedEmails)
      .groupBy(receivedEmails.processingStatus)
      .all(),

    db
      .select({
        id: receivedEmails.id,
        fromEmail: receivedEmails.fromEmail,
        fromName: receivedEmails.fromName,
        subject: receivedEmails.subject,
        processingStatus: receivedEmails.processingStatus,
        receivedAt: receivedEmails.receivedAt,
      })
      .from(receivedEmails)
      .where(sql`processing_status IN ('failed', 'processing') AND received_at >= ${sevenDaysAgo}`)
      .orderBy(desc(receivedEmails.receivedAt))
      .limit(30)
      .all(),

    db
      .select({
        id: aiCostLog.id,
        provider: aiCostLog.provider,
        model: aiCostLog.model,
        inputTokens: aiCostLog.inputTokens,
        outputTokens: aiCostLog.outputTokens,
        estimatedCostUsd: aiCostLog.estimatedCostUsd,
        error: aiCostLog.error,
        createdAt: aiCostLog.createdAt,
      })
      .from(aiCostLog)
      .where(sql`feature = 'email_triage' AND created_at >= ${sevenDaysAgo}`)
      .orderBy(desc(aiCostLog.createdAt))
      .limit(40)
      .all(),
  ]);

  const countMap = Object.fromEntries(statusCounts.map((r) => [r.status, r.count]));
  const totalEmails = Object.values(countMap).reduce((a, b) => a + b, 0);
  const errorLogs = recentTriageLogs.filter((l) => l.error);

  // Count triage results for stuck emails
  const stuckIds = stuckEmails.map((e) => e.id);
  const triageForStuck = stuckIds.length > 0
    ? await db
        .select({ emailId: aiTriageResults.emailId })
        .from(aiTriageResults)
        .where(sql`email_id IN (${sql.join(stuckIds.map((id) => sql`${id}`), sql`, `)})`)
        .all()
    : [];
  const retriagedSet = new Set(triageForStuck.map((r) => r.emailId));

  return (
    <div className="p-8 max-w-5xl">
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
        <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>Inbound Triage</h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          Email processing status and AI triage errors across all aliases.
        </p>
      </div>

      {/* Status summary */}
      <div className="grid grid-cols-2 gap-3 mb-8 lg:grid-cols-5">
        {(["triaged", "failed", "processing", "pending", "fetching"] as const).map((status) => (
          <div
            key={status}
            className="rounded border p-4"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <p className="text-[10px] uppercase tracking-widest font-medium mb-1" style={{ color: "var(--color-muted)" }}>
              {status}
            </p>
            <p className="text-2xl font-semibold" style={{ color: STATUS_COLOR[status]?.text ?? "var(--color-ink)" }}>
              {countMap[status] ?? 0}
            </p>
            <p className="text-[10px] mt-0.5" style={{ color: "var(--color-muted)" }}>
              of {totalEmails} total
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Stuck / failed emails */}
        <div className="rounded border" style={{ borderColor: "var(--color-border)" }}>
          <div
            className="px-5 py-3.5 border-b flex items-center justify-between"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
              Stuck / Failed (7d)
            </h2>
            <span className="text-xs px-2 py-0.5 rounded" style={{ background: "#dc262618", color: "#dc2626" }}>
              {stuckEmails.length}
            </span>
          </div>
          {stuckEmails.length === 0 ? (
            <p className="px-5 py-4 text-xs" style={{ color: "var(--color-muted)" }}>All emails processed successfully.</p>
          ) : (
            stuckEmails.map((email) => (
              <Link
                key={email.id}
                href={`/inbox/${email.id}`}
                className="block px-5 py-3 border-b last:border-0 hover:opacity-80 transition"
                style={{ borderColor: "var(--color-border)" }}
              >
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <span className="text-xs font-medium truncate" style={{ color: "var(--color-ink)" }}>
                    {email.subject ?? "(no subject)"}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {retriagedSet.has(email.id) && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: "#16a34a18", color: "#16a34a" }}>
                        retriaged
                      </span>
                    )}
                    <span
                      className="text-[9px] px-1.5 py-0.5 rounded font-medium uppercase"
                      style={{
                        background: STATUS_COLOR[email.processingStatus]?.bg ?? "#e5e5e518",
                        color: STATUS_COLOR[email.processingStatus]?.text ?? "#6b7280",
                      }}
                    >
                      {email.processingStatus}
                    </span>
                  </div>
                </div>
                <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
                  {email.fromName ?? email.fromEmail} · {ts(email.receivedAt)}
                </p>
              </Link>
            ))
          )}
        </div>

        {/* AI triage error log */}
        <div className="rounded border" style={{ borderColor: "var(--color-border)" }}>
          <div
            className="px-5 py-3.5 border-b flex items-center justify-between"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
              Triage AI Log (7d)
            </h2>
            {errorLogs.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded" style={{ background: "#dc262618", color: "#dc2626" }}>
                {errorLogs.length} error{errorLogs.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          {recentTriageLogs.length === 0 ? (
            <p className="px-5 py-4 text-xs" style={{ color: "var(--color-muted)" }}>No triage calls in the last 7 days.</p>
          ) : (
            recentTriageLogs.map((log) => (
              <div
                key={log.id}
                className="px-5 py-3 border-b last:border-0"
                style={{ borderColor: "var(--color-border)" }}
              >
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <span className="text-xs font-medium" style={{ color: log.error ? "#dc2626" : "var(--color-ink)" }}>
                    {log.model.includes("haiku") ? "Haiku" : "Llama"} · {log.provider}
                  </span>
                  <span className="text-[10px]" style={{ color: "var(--color-muted)" }}>{ts(log.createdAt)}</span>
                </div>
                {log.error ? (
                  <p
                    className="text-[11px] mt-1 rounded px-2 py-1 font-mono break-all"
                    style={{ background: "#dc262610", color: "#dc2626" }}
                  >
                    {log.error}
                  </p>
                ) : (
                  <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
                    {log.inputTokens + log.outputTokens} tokens · ${log.estimatedCostUsd.toFixed(5)}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

interface Recipient {
  id: string;
  type: string;
  displayName: string | null;
  address: string;
}

interface Attachment {
  id: string;
  filename: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  scanStatus: string;
}

interface TriageResult {
  id: string;
  modelName: string;
  promptVersion: string;
  summary: string | null;
  category: string | null;
  urgency: string | null;
  confidence: number | null;
  structuredData: Record<string, unknown> | null;
  recommendedAction: string | null;
  riskFlags: string[];
  reviewStatus: string;
  reviewedBy: string | null;
  reviewedAt: number | null;
  createdAt: number;
}

interface EmailDetail {
  id: string;
  fromName: string | null;
  fromEmail: string;
  subject: string | null;
  receivedAt: number;
  textBody: string | null;
  htmlBody: string | null;
  normalizedText: string | null;
  processingStatus: string;
  threadKey: string | null;
}

const URGENCY_COLORS: Record<string, { bg: string; text: string }> = {
  low: { bg: "#16a34a18", text: "#16a34a" },
  medium: { bg: "#d9770618", text: "#d97706" },
  high: { bg: "#dc262618", text: "#dc2626" },
  critical: { bg: "#7c3aed18", text: "#7c3aed" },
};

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export default function EmailDetailClient() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [email, setEmail] = useState<EmailDetail | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [triageResults, setTriageResults] = useState<TriageResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [retriaging, setRetriaging] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const fetchDetail = useCallback(async () => {
    const res = await fetch(`/api/inbound/emails/${id}`);
    if (!res.ok) {
      router.push("/inbox");
      return;
    }
    const data = (await res.json()) as {
      email: EmailDetail;
      recipients: Recipient[];
      attachments: Attachment[];
      triageResults: TriageResult[];
    };
    setEmail(data.email);
    setRecipients(data.recipients ?? []);
    setAttachments(data.attachments ?? []);
    setTriageResults(data.triageResults ?? []);
    setLoading(false);
  }, [id, router]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const handleRetriage = async () => {
    setRetriaging(true);
    const res = await fetch(`/api/inbound/emails/${id}/retriage`, { method: "POST" });
    if (res.ok) {
      await fetchDetail();
    }
    setRetriaging(false);
  };

  const handleReview = async (triageId: string, action: "approved" | "rejected") => {
    await fetch(`/api/inbound/emails/${id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ triageId, action }),
    });
    await fetchDetail();
  };

  if (loading) {
    return (
      <div className="p-8 max-w-3xl">
        <div className="h-6 w-48 rounded" style={{ background: "var(--color-surface)" }} />
        <div className="mt-6 h-32 rounded" style={{ background: "var(--color-surface)" }} />
      </div>
    );
  }

  if (!email) return null;

  const latestTriage = triageResults.length > 0
    ? triageResults.reduce((a, b) => (a.createdAt > b.createdAt ? a : b))
    : null;

  return (
    <div className="p-8 max-w-3xl">
      {/* Back link */}
      <Link href="/inbox" className="text-xs mb-4 inline-block transition" style={{ color: "var(--color-muted)" }}>
        &larr; Back to inbox
      </Link>

      {/* Header */}
      <h1 className="text-xl font-semibold mb-1">{email.subject ?? "(no subject)"}</h1>
      <div className="flex items-center gap-3 text-sm mb-6" style={{ color: "var(--color-muted)" }}>
        <span>
          From: <strong style={{ color: "var(--color-text)" }}>{email.fromName ?? email.fromEmail}</strong>
          {email.fromName && ` <${email.fromEmail}>`}
        </span>
        <span>{formatDate(email.receivedAt)}</span>
      </div>

      {/* Recipients */}
      {recipients.length > 0 && (
        <div className="text-xs mb-4" style={{ color: "var(--color-muted)" }}>
          {["to", "cc"].map((type) => {
            const addrs = recipients.filter((r) => r.type === type);
            if (addrs.length === 0) return null;
            return (
              <span key={type} className="mr-4">
                {type.toUpperCase()}: {addrs.map((r) => r.displayName ?? r.address).join(", ")}
              </span>
            );
          })}
        </div>
      )}

      {/* AI Triage Card */}
      {latestTriage && (
        <div
          className="rounded p-4 mb-6"
          style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
        >
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
              AI Triage
            </h2>
            <div className="flex items-center gap-2">
              {latestTriage.urgency && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                  style={{
                    background: URGENCY_COLORS[latestTriage.urgency]?.bg ?? "#e5e5e5",
                    color: URGENCY_COLORS[latestTriage.urgency]?.text ?? "#777",
                  }}
                >
                  {latestTriage.urgency}
                </span>
              )}
              {latestTriage.confidence !== null && (
                <span className="text-[10px]" style={{ color: "var(--color-muted)" }}>
                  {Math.round(latestTriage.confidence * 100)}% confidence
                </span>
              )}
            </div>
          </div>

          {latestTriage.summary && (
            <p className="text-sm mb-3">{latestTriage.summary}</p>
          )}

          {latestTriage.category && (
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs" style={{ color: "var(--color-muted)" }}>Category:</span>
              <span
                className="text-xs px-2 py-0.5 rounded"
                style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}
              >
                {latestTriage.category}
              </span>
            </div>
          )}

          {latestTriage.recommendedAction && (
            <div className="mb-3">
              <span className="text-xs" style={{ color: "var(--color-muted)" }}>Recommended action:</span>
              <p className="text-sm mt-0.5">{latestTriage.recommendedAction}</p>
            </div>
          )}

          {/* Structured data */}
          {latestTriage.structuredData && Object.keys(latestTriage.structuredData).length > 0 && (
            <div className="mb-3">
              <span className="text-xs mb-1 block" style={{ color: "var(--color-muted)" }}>Extracted fields:</span>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                {Object.entries(latestTriage.structuredData).map(([key, value]) => {
                  if (!value || (Array.isArray(value) && value.length === 0)) return null;
                  return (
                    <div key={key}>
                      <span style={{ color: "var(--color-muted)" }}>
                        {key.replace(/_/g, " ")}:
                      </span>{" "}
                      <span>{Array.isArray(value) ? value.join(", ") : String(value)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Risk flags */}
          {latestTriage.riskFlags.length > 0 && (
            <div className="flex items-center gap-1.5 mb-3">
              {latestTriage.riskFlags.map((flag) => (
                <span
                  key={flag}
                  className="text-[10px] px-1.5 py-0.5 rounded"
                  style={{ background: "#dc262618", color: "#dc2626" }}
                >
                  {flag}
                </span>
              ))}
            </div>
          )}

          {/* Review actions */}
          <div className="flex items-center gap-2 pt-2" style={{ borderTop: "1px solid var(--color-border)" }}>
            {latestTriage.reviewStatus === "pending" ? (
              <>
                <button
                  onClick={() => handleReview(latestTriage.id, "approved")}
                  className="px-3 py-1 text-xs rounded transition"
                  style={{ background: "#16a34a", color: "#fff" }}
                >
                  Approve
                </button>
                <button
                  onClick={() => handleReview(latestTriage.id, "rejected")}
                  className="px-3 py-1 text-xs rounded transition"
                  style={{ background: "#dc2626", color: "#fff" }}
                >
                  Reject
                </button>
              </>
            ) : (
              <span
                className="text-xs px-2 py-0.5 rounded"
                style={{
                  background: latestTriage.reviewStatus === "approved" ? "#16a34a18" : "#dc262618",
                  color: latestTriage.reviewStatus === "approved" ? "#16a34a" : "#dc2626",
                }}
              >
                {latestTriage.reviewStatus}
              </span>
            )}
            <button
              onClick={handleRetriage}
              disabled={retriaging}
              className="ml-auto px-3 py-1 text-xs rounded transition"
              style={{ border: "1px solid var(--color-border)", color: "var(--color-muted)" }}
            >
              {retriaging ? "Re-triaging..." : "Re-triage"}
            </button>
          </div>
        </div>
      )}

      {/* Attachments */}
      {attachments.length > 0 && (
        <div className="mb-6">
          <h2
            className="text-xs font-medium tracking-widest uppercase mb-2"
            style={{ color: "var(--color-muted)" }}
          >
            Attachments
          </h2>
          <div className="space-y-1">
            {attachments.map((att) => (
              <div
                key={att.id}
                className="flex items-center gap-3 rounded px-3 py-2 text-xs"
                style={{ border: "1px solid var(--color-border)" }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
                <span className="flex-1 truncate">{att.filename ?? "unnamed"}</span>
                {att.sizeBytes && (
                  <span style={{ color: "var(--color-muted)" }}>{formatBytes(att.sizeBytes)}</span>
                )}
                <span
                  className="px-1.5 py-0.5 rounded"
                  style={{
                    background: att.scanStatus === "blocked" ? "#dc262618" : "var(--color-surface)",
                    color: att.scanStatus === "blocked" ? "#dc2626" : "var(--color-muted)",
                  }}
                >
                  {att.scanStatus}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Email body */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h2
            className="text-xs font-medium tracking-widest uppercase"
            style={{ color: "var(--color-muted)" }}
          >
            Message
          </h2>
          <button
            onClick={() => setShowRaw(!showRaw)}
            className="text-[10px] px-2 py-0.5 rounded transition"
            style={{ border: "1px solid var(--color-border)", color: "var(--color-muted)" }}
          >
            {showRaw ? "Formatted" : "Raw"}
          </button>
        </div>
        <div
          className="rounded p-4 text-sm whitespace-pre-wrap overflow-auto max-h-96"
          style={{
            border: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            fontFamily: showRaw ? "monospace" : "inherit",
            fontSize: showRaw ? "12px" : "14px",
          }}
        >
          {showRaw
            ? email.textBody ?? email.normalizedText ?? "(empty)"
            : email.normalizedText ?? email.textBody ?? "(empty)"}
        </div>
      </div>
    </div>
  );
}

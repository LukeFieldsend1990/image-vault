"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface TriageSummary {
  summary: string;
  category: string;
  urgency: string;
  confidence: number;
  recommendedAction: string;
  reviewStatus: string;
}

interface EmailRow {
  id: string;
  fromName: string | null;
  fromEmail: string;
  subject: string | null;
  receivedAt: number;
  processingStatus: string;
  routingStatus: string;
  threadKey: string | null;
  triage: TriageSummary | null;
}

interface AliasInfo {
  id: string;
  alias: string;
  fullAddress: string;
  status: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  licence_request: "Licence Request",
  onboarding: "Onboarding",
  document_submission: "Document",
  clarification: "Clarification",
  scheduling: "Scheduling",
  billing: "Billing",
  legal: "Legal",
  complaint: "Complaint",
  introduction: "Introduction",
  spam: "Spam",
  other: "Other",
};

const URGENCY_COLORS: Record<string, { bg: string; text: string }> = {
  low: { bg: "#16a34a18", text: "#16a34a" },
  medium: { bg: "#d9770618", text: "#d97706" },
  high: { bg: "#dc262618", text: "#dc2626" },
  critical: { bg: "#7c3aed18", text: "#7c3aed" },
};

function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default function InboxClient() {
  const [emails, setEmails] = useState<EmailRow[]>([]);
  const [alias, setAlias] = useState<AliasInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [enabled, setEnabled] = useState(true);

  const fetchData = useCallback(async () => {
    const [emailsRes, aliasRes] = await Promise.all([
      fetch("/api/inbound/emails"),
      fetch("/api/inbound/aliases"),
    ]);
    if (emailsRes.ok) {
      const data = (await emailsRes.json()) as { emails: EmailRow[] };
      setEmails(data.emails ?? []);
    }
    if (aliasRes.ok) {
      const data = (await aliasRes.json()) as { enabled: boolean; aliases: AliasInfo[] };
      setEnabled(data.enabled);
      const active = (data.aliases ?? []).find((a: AliasInfo) => a.status === "active");
      setAlias(active ?? null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const generateAlias = async () => {
    const res = await fetch("/api/inbound/aliases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityType: "user" }),
    });
    if (res.ok) {
      const data = (await res.json()) as { alias: AliasInfo };
      setAlias(data.alias);
    }
  };

  const copyAddress = () => {
    if (!alias) return;
    navigator.clipboard.writeText(alias.fullAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="p-8 max-w-3xl">
        <div className="h-6 w-32 rounded" style={{ background: "var(--color-surface)" }} />
        <div className="mt-4 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded" style={{ background: "var(--color-surface)" }} />
          ))}
        </div>
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="p-8 max-w-3xl">
        <h1 className="text-xl font-semibold mb-1">Inbox</h1>
        <p className="text-sm mb-6" style={{ color: "var(--color-muted)" }}>
          Inbound email intake for AI-triaged conversations.
        </p>
        <div
          className="rounded p-6 text-center"
          style={{ border: "1px dashed var(--color-border)" }}
        >
          <p className="text-sm font-medium mb-1">Feature not enabled</p>
          <p className="text-xs" style={{ color: "var(--color-muted)" }}>
            Inbound email intake needs to be enabled for your account by an administrator.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-xl font-semibold mb-1">Inbox</h1>
      <p className="text-sm mb-6" style={{ color: "var(--color-muted)" }}>
        Emails CC&apos;d to your intake address, triaged by AI.
      </p>

      {/* Alias banner */}
      <div
        className="rounded p-4 mb-6 flex items-center justify-between gap-4"
        style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
      >
        {alias ? (
          <>
            <div className="min-w-0">
              <p className="text-xs font-medium mb-1" style={{ color: "var(--color-muted)" }}>
                YOUR INTAKE ADDRESS
              </p>
              <p className="text-sm font-mono truncate">{alias.fullAddress}</p>
              <p className="text-xs mt-1" style={{ color: "var(--color-muted)" }}>
                CC this address into any relevant email conversation.
              </p>
            </div>
            <button
              onClick={copyAddress}
              className="shrink-0 px-3 py-1.5 text-xs rounded transition"
              style={{
                background: copied ? "#16a34a" : "var(--color-ink)",
                color: "#fff",
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </>
        ) : (
          <>
            <div>
              <p className="text-sm">No intake address yet.</p>
              <p className="text-xs mt-1" style={{ color: "var(--color-muted)" }}>
                Generate one to start receiving CC&apos;d emails.
              </p>
            </div>
            <button
              onClick={generateAlias}
              className="shrink-0 px-3 py-1.5 text-xs rounded"
              style={{ background: "var(--color-ink)", color: "#fff" }}
            >
              Generate
            </button>
          </>
        )}
      </div>

      {/* Email list */}
      {emails.length === 0 ? (
        <div
          className="text-center py-12 rounded"
          style={{ border: "1px dashed var(--color-border)" }}
        >
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>
            No emails received yet.
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--color-muted)" }}>
            CC your intake address into an email thread and it will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {emails.map((email) => (
            <Link
              key={email.id}
              href={`/inbox/${email.id}`}
              className="block rounded p-4 transition hover:shadow-sm"
              style={{
                border: "1px solid var(--color-border)",
                background: "var(--color-bg)",
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium truncate">
                      {email.fromName ?? email.fromEmail}
                    </span>
                    {email.fromName && (
                      <span className="text-xs truncate" style={{ color: "var(--color-muted)" }}>
                        {email.fromEmail}
                      </span>
                    )}
                  </div>
                  <p className="text-sm truncate" style={{ color: "var(--color-text)" }}>
                    {email.subject ?? "(no subject)"}
                  </p>
                  {email.triage && (
                    <p
                      className="text-xs mt-1 line-clamp-1"
                      style={{ color: "var(--color-muted)" }}
                    >
                      {email.triage.summary}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                    {formatDate(email.receivedAt)}
                  </span>
                  {email.triage && (
                    <div className="flex items-center gap-1.5 mt-1 justify-end">
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded"
                        style={{
                          background: URGENCY_COLORS[email.triage.urgency]?.bg ?? "#e5e5e5",
                          color: URGENCY_COLORS[email.triage.urgency]?.text ?? "#777",
                        }}
                      >
                        {email.triage.urgency}
                      </span>
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded"
                        style={{ background: "var(--color-surface)", color: "var(--color-muted)" }}
                      >
                        {CATEGORY_LABELS[email.triage.category] ?? email.triage.category}
                      </span>
                      {email.triage.confidence < 0.6 && (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{ background: "#dc262618", color: "#dc2626" }}
                        >
                          low confidence
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Settings link */}
      <div className="mt-6 text-center">
        <Link
          href="/settings/email-intake"
          className="text-xs transition"
          style={{ color: "var(--color-muted)" }}
        >
          Manage email intake settings
        </Link>
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

interface SkillParameter {
  name: string;
  type: "string" | "number" | "boolean" | "select";
  description: string;
  required: boolean;
  default?: unknown;
  options?: string[];
}

interface SkillSuggestion {
  skillId: string;
  displayName: string;
  description: string;
  prefilled: Record<string, unknown>;
  confidence: number;
}

interface SkillResultData {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}

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
  const [linkedAssets, setLinkedAssets] = useState<Array<{ type: string; name: string; href: string }>>([]);
  const [skills, setSkills] = useState<SkillSuggestion[]>([]);
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const [skillForms, setSkillForms] = useState<Record<string, Record<string, unknown>>>({});
  const [executingSkill, setExecutingSkill] = useState<string | null>(null);
  const [skillResults, setSkillResults] = useState<Record<string, SkillResultData>>({});

  async function fetchDetail() {
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

    // Fetch linked assets and skills in parallel
    const [assetsRes, skillsRes] = await Promise.all([
      fetch(`/api/inbound/emails/${id}/linked-assets`),
      fetch(`/api/inbound/emails/${id}/skills`),
    ]);
    if (assetsRes.ok) {
      const assetsData = (await assetsRes.json()) as { assets: Array<{ type: string; name: string; href: string }> };
      setLinkedAssets(assetsData.assets ?? []);
    }
    if (skillsRes.ok) {
      const skillsData = (await skillsRes.json()) as { suggestions: SkillSuggestion[] };
      const suggestions = skillsData.suggestions ?? [];
      setSkills(suggestions);
      // Pre-fill forms from suggestions
      const forms: Record<string, Record<string, unknown>> = {};
      for (const s of suggestions) {
        forms[s.skillId] = { ...s.prefilled };
      }
      setSkillForms(forms);
    }
  }

  useEffect(() => {
    void fetchDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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

  const handleExecuteSkill = async (skillId: string) => {
    setExecutingSkill(skillId);
    const params = skillForms[skillId] ?? {};
    const res = await fetch(`/api/inbound/emails/${id}/skills`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillId, params }),
    });
    const result = (await res.json()) as SkillResultData;
    setSkillResults((prev) => ({ ...prev, [skillId]: result }));
    setExecutingSkill(null);
  };

  const updateSkillParam = useCallback((skillId: string, key: string, value: unknown) => {
    setSkillForms((prev) => ({
      ...prev,
      [skillId]: { ...prev[skillId], [key]: value },
    }));
  }, []);

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
            <div
              className="mb-3 px-3 py-2 rounded text-sm"
              style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}
            >
              <span className="text-[10px] uppercase tracking-wider font-medium block mb-1" style={{ color: "var(--color-muted)" }}>
                Recommended action
              </span>
              {latestTriage.recommendedAction}
            </div>
          )}

          {/* Action items */}
          {(() => {
            const items = latestTriage.structuredData?.action_items;
            if (!Array.isArray(items) || items.length === 0) return null;
            return (
              <div className="mb-3">
                <span className="text-[10px] uppercase tracking-wider font-medium block mb-1.5" style={{ color: "var(--color-muted)" }}>
                  Action items
                </span>
                <div className="flex flex-col gap-1.5">
                  {items.map((item: string, i: number) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 px-3 py-1.5 rounded text-xs"
                      style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}
                    >
                      <span style={{ color: "var(--color-muted)" }}>{i + 1}.</span>
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Linked assets */}
          {(() => {
            if (!latestTriage.structuredData) return null;
            const links: Array<{ label: string; href: string }> = [];
            for (const asset of linkedAssets) {
              links.push({ label: `${asset.type === "package" ? "Package" : "Licence"}: ${asset.name}`, href: asset.href });
            }
            if (links.length === 0) return null;
            return (
              <div className="mb-3">
                <span className="text-[10px] uppercase tracking-wider font-medium block mb-1.5" style={{ color: "var(--color-muted)" }}>
                  Linked assets
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {links.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className="text-xs px-2.5 py-1 rounded transition hover:opacity-80"
                      style={{ background: "#2563eb18", color: "#2563eb", border: "1px solid #2563eb30" }}
                    >
                      {link.label} &rarr;
                    </Link>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Structured data */}
          {(() => {
            if (!latestTriage.structuredData) return null;
            const entries = Object.entries(latestTriage.structuredData).filter(
              ([key, value]) => key !== "action_items" && value && !(Array.isArray(value) && value.length === 0)
            );
            if (entries.length === 0) return null;
            return (
              <div className="mb-3">
                <span className="text-[10px] uppercase tracking-wider font-medium block mb-1.5" style={{ color: "var(--color-muted)" }}>
                  Extracted fields
                </span>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {entries.map(([key, value]) => (
                    <div key={key}>
                      <span style={{ color: "var(--color-muted)" }}>
                        {key.replace(/_/g, " ")}:
                      </span>{" "}
                      <span>{Array.isArray(value) ? value.join(", ") : String(value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

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

      {/* Suggested Actions (Skills) */}
      {skills.length > 0 && (
        <div
          className="rounded p-4 mb-6"
          style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
        >
          <h2 className="text-xs font-medium tracking-widest uppercase mb-3" style={{ color: "var(--color-muted)" }}>
            Suggested Actions
          </h2>
          <div className="flex flex-col gap-2">
            {skills.map((skill) => {
              const isExpanded = expandedSkill === skill.skillId;
              const result = skillResults[skill.skillId];
              const isExecuting = executingSkill === skill.skillId;

              return (
                <div
                  key={skill.skillId}
                  className="rounded"
                  style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)" }}
                >
                  <button
                    onClick={() => setExpandedSkill(isExpanded ? null : skill.skillId)}
                    className="w-full flex items-center justify-between px-3 py-2.5 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                      </svg>
                      <span className="text-sm font-medium">{skill.displayName}</span>
                      {skill.confidence < 0.6 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "#d9770618", color: "#d97706" }}>
                          low confidence
                        </span>
                      )}
                    </div>
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s" }}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>

                  {isExpanded && (
                    <div className="px-3 pb-3" style={{ borderTop: "1px solid var(--color-border)" }}>
                      <p className="text-xs mt-2 mb-3" style={{ color: "var(--color-muted)" }}>
                        {skill.description}
                      </p>

                      {/* Parameter form */}
                      <div className="flex flex-col gap-2 mb-3">
                        {Object.entries(skill.prefilled).map(([key, defaultVal]) => (
                          <div key={key}>
                            <label className="text-[10px] uppercase tracking-wider font-medium block mb-1" style={{ color: "var(--color-muted)" }}>
                              {key.replace(/_/g, " ")}
                            </label>
                            {key === "role" ? (
                              <select
                                value={(skillForms[skill.skillId]?.[key] as string) ?? (defaultVal as string) ?? ""}
                                onChange={(e) => updateSkillParam(skill.skillId, key, e.target.value)}
                                className="w-full text-xs px-2 py-1.5 rounded"
                                style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
                              >
                                <option value="talent">Talent</option>
                                <option value="rep">Rep</option>
                                <option value="licensee">Licensee</option>
                              </select>
                            ) : key === "licence_type" ? (
                              <select
                                value={(skillForms[skill.skillId]?.[key] as string) ?? (defaultVal as string) ?? ""}
                                onChange={(e) => updateSkillParam(skill.skillId, key, e.target.value)}
                                className="w-full text-xs px-2 py-1.5 rounded"
                                style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
                              >
                                <option value="">Any</option>
                                <option value="film_double">Film Double</option>
                                <option value="game_character">Game Character</option>
                                <option value="commercial">Commercial</option>
                                <option value="ai_avatar">AI Avatar</option>
                                <option value="training_data">Training Data</option>
                                <option value="monitoring_reference">Monitoring Reference</option>
                              </select>
                            ) : (
                              <input
                                type="text"
                                value={(skillForms[skill.skillId]?.[key] as string) ?? (defaultVal as string) ?? ""}
                                onChange={(e) => updateSkillParam(skill.skillId, key, e.target.value)}
                                className="w-full text-xs px-2 py-1.5 rounded"
                                style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
                              />
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Result display */}
                      {result && (
                        <div
                          className="mb-3 px-3 py-2 rounded text-xs"
                          style={{
                            background: result.success ? "#16a34a12" : "#dc262612",
                            border: `1px solid ${result.success ? "#16a34a30" : "#dc262630"}`,
                            color: result.success ? "#16a34a" : "#dc2626",
                          }}
                        >
                          {result.message}
                          {result.success && Array.isArray(result.data?.licences) && (
                            <div className="mt-2 flex flex-col gap-1">
                              {(result.data.licences as Array<Record<string, unknown>>).map((lic) => (
                                <div
                                  key={lic.id as string}
                                  className="flex items-center justify-between px-2 py-1 rounded"
                                  style={{ background: "var(--color-surface)", color: "var(--color-text)", border: "1px solid var(--color-border)" }}
                                >
                                  <span>{lic.projectName as string} — {lic.productionCompany as string}</span>
                                  <div className="flex items-center gap-2">
                                    <span
                                      className="px-1.5 py-0.5 rounded text-[10px]"
                                      style={{
                                        background: (lic.status as string) === "APPROVED" ? "#16a34a18" : "#d9770618",
                                        color: (lic.status as string) === "APPROVED" ? "#16a34a" : "#d97706",
                                      }}
                                    >
                                      {lic.status as string}
                                    </span>
                                    <Link
                                      href={lic.link as string}
                                      className="text-[10px] px-1.5 py-0.5 rounded transition hover:opacity-80"
                                      style={{ background: "#2563eb18", color: "#2563eb" }}
                                    >
                                      View
                                    </Link>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      <button
                        onClick={() => handleExecuteSkill(skill.skillId)}
                        disabled={isExecuting}
                        className="px-3 py-1.5 text-xs rounded transition font-medium"
                        style={{ background: "#0a0a0a", color: "#fff", opacity: isExecuting ? 0.6 : 1 }}
                      >
                        {isExecuting ? "Running..." : `Run: ${skill.displayName}`}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
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

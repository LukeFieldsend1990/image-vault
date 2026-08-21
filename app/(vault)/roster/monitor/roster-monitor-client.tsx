"use client";

/**
 * Rep roster monitor: read-only likeness-monitor visibility across managed
 * talent, plus cross-client offender accounts (one account hitting several
 * clients is one legal action, not several). No mutations here by design —
 * triage stays with the talent on /vault/monitor.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { FadeImage } from "@/app/(vault)/fade-image";
import { platformName } from "@/lib/monitor/platforms";

interface RosterTalent {
  talentId: string;
  fullName: string;
  profileImageUrl: string | null;
  monitor: { status: string; cadence: string; scope: string; lastScanAt: number | null } | null;
  coverage: { tier: "unanchored" | "baseline" | "anchored" | "fortified"; score: number };
  referenceCount: number;
  hits: { open: number; total: number; last30d: number; latestAt: number | null };
  lastScan: { status: string; startedAt: number; completedAt: number | null } | null;
}

interface CrossClientOffender {
  accountId: string;
  platform: string;
  handle: string;
  displayName: string | null;
  followerCount: number | null;
  status: string;
  cumulativeViewsCompact: string;
  priority: { score: number; reason: string };
  clientsAffected: { talentId: string; name: string; hitCount: number; openHitCount: number }[];
  otherTalentAffectedCount: number;
}

interface RepHit {
  id: string;
  platform: string;
  contentType: string;
  contentUrl: string;
  authorHandle: string | null;
  nsfw?: boolean;
  hasThumbnail?: boolean;
  confidence: number;
  aiGeneratedLikelihood: number;
  riskLevel: string;
  status: string;
  aiRationale: string | null;
  detectedAt: number;
}

interface TalentDetail {
  hits: RepHit[];
}

const TIER_LABELS: Record<RosterTalent["coverage"]["tier"], { label: string; color: string }> = {
  unanchored: { label: "Unanchored", color: "#d97706" },
  baseline: { label: "Baseline", color: "#6b7280" },
  anchored: { label: "Vault-anchored", color: "var(--color-accent)" },
  fortified: { label: "Fortified", color: "#16a34a" },
};

const RISK_COLORS: Record<string, string> = {
  low: "#6b7280",
  medium: "#d97706",
  high: "#dc2626",
  critical: "#7f1d1d",
};

function fmtDate(ts: number | null): string {
  if (!ts) return "never";
  return new Date(ts * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * Captured evidence still for a hit, via the same authorised proxy the talent
 * view uses (the route checks the talent_reps link for rep sessions). NSFW
 * previews stay blurred — a rep triaging over someone's shoulder shouldn't
 * have explicit content spring onto the screen uninvited.
 */
function RepHitThumb({ hit }: { hit: RepHit }) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  return (
    <span
      className="relative h-12 w-9 shrink-0 overflow-hidden rounded"
      style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/monitor/hits/${hit.id}/thumbnail`}
        alt=""
        loading="lazy"
        onError={() => setBroken(true)}
        className="h-full w-full object-cover"
        style={hit.nsfw ? { filter: "blur(8px)", transform: "scale(1.1)" } : undefined}
      />
    </span>
  );
}

function TalentMonitorCard({ talent }: { talent: RosterTalent }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<TalentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const tier = TIER_LABELS[talent.coverage.tier];

  const toggle = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !detail && !detailLoading) {
      setDetailLoading(true);
      try {
        const res = await fetch(`/api/roster/${talent.talentId}/monitor`);
        if (res.ok) setDetail((await res.json()) as TalentDetail);
      } finally {
        setDetailLoading(false);
      }
    }
  };

  return (
    <div
      className="rounded border"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <button onClick={toggle} className="w-full px-4 py-3 flex items-center gap-3 text-left">
        {talent.profileImageUrl ? (
          <FadeImage
            src={talent.profileImageUrl}
            alt={talent.fullName}
            className="h-9 w-9 rounded-full object-cover shrink-0"
          />
        ) : (
          <div
            className="h-9 w-9 rounded-full shrink-0 flex items-center justify-center text-xs font-semibold"
            style={{ background: "var(--color-border)", color: "var(--color-muted)" }}
          >
            {talent.fullName.slice(0, 1)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink)" }}>
              {talent.fullName}
            </p>
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold shrink-0" style={{ color: tier.color }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: tier.color }} />
              {tier.label} {talent.coverage.score}/100
            </span>
          </div>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
            {talent.monitor
              ? `Monitor ${talent.monitor.status} · ${talent.monitor.cadence} · last scan ${fmtDate(talent.monitor.lastScanAt)}`
              : "Monitor not set up"}
            {` · ${talent.referenceCount} reference${talent.referenceCount === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p
            className="text-sm font-semibold"
            style={{ color: talent.hits.open > 0 ? "var(--color-accent)" : "var(--color-muted)" }}
          >
            {talent.hits.open} open
          </p>
          <p className="text-[10px]" style={{ color: "var(--color-muted)" }}>
            {talent.hits.last30d} in 30d · {talent.hits.total} total
          </p>
        </div>
      </button>

      {expanded && (
        <div className="border-t px-4 py-3 space-y-2" style={{ borderColor: "var(--color-border)" }}>
          {detailLoading && (
            <p className="text-xs" style={{ color: "var(--color-muted)" }}>Loading hits…</p>
          )}
          {detail && detail.hits.length === 0 && (
            <p className="text-xs" style={{ color: "var(--color-muted)" }}>No hits recorded.</p>
          )}
          {detail?.hits.slice(0, 10).map((hit) => (
            <div key={hit.id} className="flex items-start gap-3">
              {hit.hasThumbnail && <RepHitThumb hit={hit} />}
              <span
                className="mt-1 h-1.5 w-1.5 rounded-full shrink-0"
                style={{ background: RISK_COLORS[hit.riskLevel] ?? "#6b7280" }}
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs truncate" style={{ color: "var(--color-ink)" }}>
                  <span className="font-medium">{platformName(hit.platform)}</span>
                  {hit.authorHandle ? ` · @${hit.authorHandle.replace(/^@/, "")}` : ""} · {hit.confidence}% match ·{" "}
                  {hit.aiGeneratedLikelihood}% AI · {hit.status.replace(/_/g, " ")}
                  {hit.nsfw ? " · NSFW" : ""}
                </p>
                <p className="text-[10px]" style={{ color: "var(--color-muted)" }}>
                  detected {fmtDate(hit.detectedAt)}
                </p>
                {hit.aiRationale && (
                  <p className="text-[11px] truncate" style={{ color: "var(--color-muted)" }}>
                    {hit.aiRationale}
                  </p>
                )}
              </div>
              <a
                href={hit.contentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] underline underline-offset-2 shrink-0"
                style={{ color: "var(--color-accent)" }}
              >
                view
              </a>
            </div>
          ))}
          <p className="text-[10px] pt-1" style={{ color: "var(--color-muted)" }}>
            Read-only view — triage actions stay with the talent.
          </p>
        </div>
      )}
    </div>
  );
}

export default function RosterMonitorClient() {
  const [talents, setTalents] = useState<RosterTalent[]>([]);
  const [offenders, setOffenders] = useState<CrossClientOffender[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/roster/monitor");
        if (!res.ok) throw new Error(res.status === 403 ? "Rep accounts only" : "Failed to load");
        const data = (await res.json()) as {
          talents: RosterTalent[];
          crossClientAccounts: CrossClientOffender[];
        };
        setTalents(data.talents ?? []);
        setOffenders(data.crossClientAccounts ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>
          Representative
        </p>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>
            Likeness Monitor
          </h1>
          <div className="flex items-center gap-3 shrink-0">
            <Link
              href="/roster/deepfakes"
              className="text-xs font-medium underline underline-offset-2"
              style={{ color: "var(--color-accent)" }}
            >
              Deepfake statistics →
            </Link>
            <Link
              href="/roster"
              className="text-xs font-medium underline underline-offset-2"
              style={{ color: "var(--color-muted)" }}
            >
              ← My Roster
            </Link>
          </div>
        </div>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          Detection coverage and likeness alerts across your roster, read-only.
        </p>
      </div>

      {loading && <p className="text-sm" style={{ color: "var(--color-muted)" }}>Loading…</p>}
      {error && <p className="text-sm" style={{ color: "var(--color-accent)" }}>{error}</p>}

      {!loading && !error && (
        <>
          <p
            className="text-xs font-medium tracking-widest uppercase mb-3"
            style={{ color: "var(--color-muted)" }}
          >
            Clients ({talents.length})
          </p>
          {talents.length === 0 ? (
            <p className="text-sm mb-8" style={{ color: "var(--color-muted)" }}>
              No talent on your roster yet.
            </p>
          ) : (
            <div className="space-y-2 mb-8">
              {talents.map((t) => (
                <TalentMonitorCard key={t.talentId} talent={t} />
              ))}
            </div>
          )}

          <p
            className="text-xs font-medium tracking-widest uppercase mb-3"
            style={{ color: "var(--color-muted)" }}
          >
            Cross-client activity
          </p>
          {offenders.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>
              No account is currently hitting more than one of your clients.
            </p>
          ) : (
            <div className="space-y-2">
              {offenders.map((account) => (
                <div
                  key={account.accountId}
                  className="rounded border px-4 py-3"
                  style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink)" }}>
                      @{account.handle}
                      <span className="font-normal" style={{ color: "var(--color-muted)" }}>
                        {" "}· {account.platform} · {account.cumulativeViewsCompact} views ·{" "}
                        {account.status}
                      </span>
                    </p>
                    <p className="text-[11px] shrink-0" style={{ color: "var(--color-muted)" }}>
                      {account.priority.reason}
                    </p>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {account.clientsAffected.map((client) => (
                      <span
                        key={client.talentId}
                        className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]"
                        style={{ borderColor: "var(--color-border)", color: "var(--color-ink)" }}
                      >
                        {client.name}
                        <span style={{ color: "var(--color-accent)" }}>
                          {client.openHitCount > 0 ? `${client.openHitCount} open` : `${client.hitCount}`}
                        </span>
                      </span>
                    ))}
                    {account.otherTalentAffectedCount > 0 && (
                      <span className="text-[11px]" style={{ color: "var(--color-muted)" }}>
                        also affecting {account.otherTalentAffectedCount} other protected talent
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

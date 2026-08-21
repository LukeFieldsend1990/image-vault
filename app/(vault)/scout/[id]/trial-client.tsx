"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// ── Types (mirror /api/scout/:id payload) ───────────────────────────────────

interface DetectorReadings {
  faceEmbeddingSimilarity: number | null;
  perceptualHashDistance: number | null;
  geometryFingerprintCorrelation: number | null;
  syntheticMediaScore: number | null;
  synthetic: { analyst: string; generatorFamily: string | null; evidence: string[] } | null;
  vigilanceMatchTerm: string | null;
}

interface TrialHit {
  id: string;
  platform: string;
  contentType: string;
  contentUrl: string;
  authorHandle: string | null;
  caption: string | null;
  nsfw: boolean;
  hasThumbnail: boolean;
  confidence: number;
  aiGeneratedLikelihood: number;
  riskLevel: "low" | "medium" | "high" | "critical";
  matchSignals: string[];
  aiRationale: string | null;
  detectorReadings: DetectorReadings | null;
  detectedAt: number;
  migrated: boolean;
}

interface TrialPhoto {
  id: string;
  kind: "face" | "full_body" | "scan_3d";
  originalName: string | null;
  sizeBytes: number;
  createdAt: number;
}

interface ScanProgress {
  stage: string;
  stageLabel: string;
  platforms: Record<string, { status: "pending" | "sweeping" | "done"; candidates: number | null }>;
  candidatesFound: number;
  log: { at: number; text: string }[];
  updatedAt: number;
}

interface TrialDetail {
  id: string;
  tmdbId: number;
  tmdbName: string;
  tmdbProfileUrl: string | null;
  knownFor: Array<{ title: string; year: string; type: string }>;
  status: "draft" | "running" | "complete" | "error";
  error: string | null;
  platformsChecked: number;
  candidatesAnalysed: number;
  hitsFound: number;
  aiProvider: string | null;
  coverage: { tier: string; score: number; improvements: string[] };
  converted: boolean;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  progress: ScanProgress | null;
  photos: TrialPhoto[];
  hits: TrialHit[];
}

interface TrialQuota {
  limit: number;
  used: number;
  remaining: number;
}

// ── Copy tables ─────────────────────────────────────────────────────────────

const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  x: "X",
  pinterest: "Pinterest",
  reddit: "Reddit",
  google: "Google Images",
  getty: "Stock libraries",
  midjourney: "AI platforms",
};

const STAGES: Array<{ id: string; label: string }> = [
  { id: "preparing", label: "Anchor" },
  { id: "discovering", label: "Discover" },
  { id: "matching", label: "Match" },
  { id: "verifying", label: "Verify" },
  { id: "adjudicating", label: "Adjudicate" },
  { id: "finalizing", label: "Record" },
];

const RISK_STYLES: Record<TrialHit["riskLevel"], { label: string; bg: string; fg: string }> = {
  low: { label: "Low risk", bg: "rgba(107,114,128,0.12)", fg: "#6b7280" },
  medium: { label: "Medium risk", bg: "rgba(184,134,11,0.12)", fg: "#b8860b" },
  high: { label: "High risk", bg: "rgba(188,61,44,0.12)", fg: "var(--color-accent)" },
  critical: { label: "Critical", bg: "var(--color-accent)", fg: "white" },
};

const TIER_COPY: Record<string, { label: string; blurb: string; color: string }> = {
  unanchored: {
    label: "Unanchored",
    blurb: "Matching runs on name and filmography alone — add a face photo to anchor it.",
    color: "var(--color-muted)",
  },
  baseline: {
    label: "Baseline",
    blurb: "Anchored to a single public headshot. Uploaded angles sharpen every verdict.",
    color: "#b8860b",
  },
  anchored: {
    label: "Anchored",
    blurb: "Identity checks compare against your uploaded references, not just a public photo.",
    color: "#2d7a4f",
  },
  fortified: {
    label: "Fortified",
    blurb: "Multi-angle reference set — the strongest matching a trial can run.",
    color: "#2d7a4f",
  },
};

const UPLOAD_SLOTS: Array<{
  kind: TrialPhoto["kind"];
  title: string;
  blurb: string;
  accept: string;
}> = [
  {
    kind: "face",
    title: "Face angles",
    blurb: "Front, three-quarter, profile — each angle sharpens face matching.",
    accept: "image/jpeg,image/png,image/webp,image/heic,image/heif",
  },
  {
    kind: "full_body",
    title: "Full body",
    blurb: "Extends matching beyond the face.",
    accept: "image/jpeg,image/png,image/webp,image/heic,image/heif",
  },
  {
    kind: "scan_3d",
    title: "3D scan",
    blurb: "GLB, OBJ, FBX and friends — raises the coverage tier.",
    accept: ".glb,.gltf,.obj,.fbx,.ply,.stl,.usdz,.zip",
  },
];

const KIND_LABELS: Record<TrialPhoto["kind"], string> = {
  face: "Face",
  full_body: "Full body",
  scan_3d: "3D scan",
};

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

function formatClock(unix: number): string {
  return new Date(unix * 1000).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ── Component ───────────────────────────────────────────────────────────────

export default function TrialClient({ trialId }: { trialId: string }) {
  const router = useRouter();
  const [trial, setTrial] = useState<TrialDetail | null>(null);
  const [quota, setQuota] = useState<TrialQuota | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/scout/${trialId}`);
    if (res.status === 404) {
      setNotFound(true);
      return null;
    }
    if (!res.ok) return null;
    const detail = (await res.json()) as TrialDetail;
    setTrial(detail);
    return detail;
  }, [trialId]);

  const loadQuota = useCallback(async () => {
    const res = await fetch("/api/scout");
    if (!res.ok) return;
    const payload = (await res.json()) as { quota: TrialQuota };
    setQuota(payload.quota);
  }, []);

  useEffect(() => {
    void load();
    void loadQuota();
  }, [load, loadQuota]);

  // Poll while the sweep runs — the row narrates itself via progress_json.
  useEffect(() => {
    if (trial?.status !== "running") {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current) return;
    pollRef.current = setInterval(() => {
      void load();
    }, 3000);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [trial?.status, load]);

  const upload = useCallback(
    async (kind: TrialPhoto["kind"], file: File) => {
      setBusy(true);
      setError(null);
      try {
        const form = new FormData();
        form.set("kind", kind);
        form.set("file", file);
        const res = await fetch(`/api/scout/${trialId}/photos`, { method: "POST", body: form });
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { error?: string };
          setError(payload.error ?? "Upload failed");
          return;
        }
        await load();
      } finally {
        setBusy(false);
      }
    },
    [trialId, load]
  );

  const removePhoto = useCallback(
    async (photoId: string) => {
      setBusy(true);
      try {
        await fetch(`/api/scout/${trialId}/photos/${photoId}`, { method: "DELETE" });
        await load();
      } finally {
        setBusy(false);
      }
    },
    [trialId, load]
  );

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/scout/${trialId}/run`, { method: "POST" });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(payload.error ?? "Could not start the sweep");
        return;
      }
      await Promise.all([load(), loadQuota()]);
    } finally {
      setBusy(false);
    }
  }, [trialId, load, loadQuota]);

  const retry = useCallback(async () => {
    if (!trial) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/scout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tmdbId: trial.tmdbId,
          name: trial.tmdbName,
          profileImageUrl: trial.tmdbProfileUrl,
          knownFor: trial.knownFor,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { trialId?: string; error?: string };
      if (!res.ok || !payload.trialId) {
        setError(payload.error ?? "Could not open a fresh trial");
        return;
      }
      router.push(`/scout/${payload.trialId}`);
    } finally {
      setBusy(false);
    }
  }, [trial, router]);

  if (notFound) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-10">
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          Trial not found.{" "}
          <Link href="/scout" className="underline" style={{ color: "var(--color-accent)" }}>
            Back to Scout
          </Link>
        </p>
      </div>
    );
  }
  if (!trial) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-10 text-sm" style={{ color: "var(--color-muted)" }}>
        Loading trial…
      </div>
    );
  }

  const tier = TIER_COPY[trial.coverage.tier] ?? TIER_COPY.unanchored;
  const progress = trial.progress;

  return (
    <div className="max-w-3xl mx-auto px-6 py-10 space-y-8">
      {/* Header */}
      <div>
        <Link href="/scout" className="text-xs" style={{ color: "var(--color-muted)" }}>
          ← Image Scout
        </Link>
        <div className="mt-3 flex items-center gap-4">
          {trial.tmdbProfileUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- TMDB headshot, no optimizer
            <img
              src={trial.tmdbProfileUrl}
              alt={trial.tmdbName}
              className="rounded-full object-cover"
              style={{ width: 64, height: 64, border: "1px solid var(--color-border)" }}
            />
          ) : (
            <div
              className="rounded-full flex items-center justify-center text-lg font-semibold"
              style={{
                width: 64,
                height: 64,
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                color: "var(--color-muted)",
              }}
            >
              {trial.tmdbName
                .split(" ")
                .slice(0, 2)
                .map((p) => p[0] ?? "")
                .join("")}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight truncate" style={{ color: "var(--color-ink)" }}>
              {trial.tmdbName}
            </h1>
            <p className="text-xs truncate" style={{ color: "var(--color-muted)" }}>
              {trial.knownFor.length
                ? trial.knownFor.map((k) => `${k.title}${k.year ? ` (${k.year})` : ""}`).join(" · ")
                : "TMDB subject"}
            </p>
          </div>
        </div>
        {trial.converted && (
          <div
            className="mt-4 rounded px-4 py-3 text-sm"
            style={{ background: "rgba(45,122,79,0.08)", border: "1px solid rgba(45,122,79,0.3)", color: "#2d7a4f" }}
          >
            {trial.tmdbName} has joined Image Vault — these results now live in their real monitor.
          </div>
        )}
      </div>

      {error && (
        <div className="text-xs px-3 py-2 rounded" style={{ background: "var(--color-surface)", color: "var(--color-accent)" }}>
          {error}
        </div>
      )}

      {/* ── Draft: reference material + coverage + launch ── */}
      {trial.status === "draft" && (
        <>
          <section className="space-y-3">
            <h2 className="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
              Reference material — optional, but it shows
            </h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {UPLOAD_SLOTS.map((slot) => (
                <label
                  key={slot.kind}
                  className="rounded p-4 cursor-pointer transition hover:bg-black/[0.02] block"
                  style={{ border: "1px dashed var(--color-border)", background: "var(--color-surface)" }}
                >
                  <input
                    type="file"
                    accept={slot.accept}
                    className="hidden"
                    disabled={busy}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void upload(slot.kind, file);
                      e.target.value = "";
                    }}
                  />
                  <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                    {slot.title}
                  </p>
                  <p className="mt-1 text-xs" style={{ color: "var(--color-muted)" }}>
                    {slot.blurb}
                  </p>
                  <p className="mt-2 text-xs" style={{ color: "var(--color-accent)" }}>
                    {busy ? "Working…" : "Upload +"}
                  </p>
                </label>
              ))}
            </div>
            {trial.photos.length > 0 && (
              <div
                className="rounded divide-y"
                style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)", borderColor: "var(--color-border)" }}
              >
                {trial.photos.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 px-4 py-2.5 text-sm" style={{ borderColor: "var(--color-border)" }}>
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded uppercase tracking-widest shrink-0"
                      style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-muted)" }}
                    >
                      {KIND_LABELS[p.kind]}
                    </span>
                    <span className="flex-1 truncate" style={{ color: "var(--color-ink)" }}>
                      {p.originalName ?? "upload"}
                    </span>
                    <span className="text-xs shrink-0" style={{ color: "var(--color-muted)", fontFamily: "var(--font-mono, monospace)" }}>
                      {formatBytes(p.sizeBytes)}
                    </span>
                    <button
                      onClick={() => void removePhoto(p.id)}
                      disabled={busy}
                      className="text-xs shrink-0"
                      style={{ color: "var(--color-muted)" }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Coverage meter */}
          <section
            className="rounded p-4 space-y-3"
            style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
                Detection coverage
              </p>
              <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: tier.color }}>
                {tier.label}
              </span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${trial.coverage.score}%`, background: tier.color }}
              />
            </div>
            <p className="text-xs" style={{ color: "var(--color-muted)" }}>
              {tier.blurb}
            </p>
            {trial.coverage.improvements.length > 0 && (
              <ul className="text-xs space-y-1" style={{ color: "var(--color-muted)" }}>
                {trial.coverage.improvements.map((line) => (
                  <li key={line}>· {line}</li>
                ))}
              </ul>
            )}
          </section>

          {/* Launch */}
          <section
            className="rounded p-5 flex items-center justify-between gap-4 flex-wrap"
            style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
          >
            <div className="min-w-0">
              <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                Ready when you are
              </p>
              <p className="mt-1 text-xs max-w-md" style={{ color: "var(--color-muted)" }}>
                One run sweeps every enabled platform, verifies faces against your references, runs
                synthetic-media analysis and lets the AI adjudicator call each candidate. Takes a
                few minutes — you can watch it live.
              </p>
            </div>
            <div className="text-right shrink-0">
              <button
                onClick={() => void run()}
                disabled={busy || (quota !== null && quota.remaining <= 0)}
                className="text-sm px-5 py-2.5 rounded font-medium"
                style={{
                  background: "var(--color-accent)",
                  color: "white",
                  opacity: busy || (quota !== null && quota.remaining <= 0) ? 0.5 : 1,
                }}
              >
                {busy ? "Starting…" : "Run trial sweep"}
              </button>
              {quota && (
                <p className="mt-1.5 text-xs" style={{ color: "var(--color-muted)" }}>
                  {quota.remaining > 0
                    ? `Uses 1 of your ${quota.remaining} remaining run${quota.remaining === 1 ? "" : "s"}`
                    : "No runs remaining — ask us for more"}
                </p>
              )}
            </div>
          </section>
        </>
      )}

      {/* ── Running: live telemetry ── */}
      {trial.status === "running" && (
        <section className="space-y-4">
          <div
            className="rounded p-5 space-y-5"
            style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
          >
            {/* Stage stepper */}
            <div className="flex items-center gap-1">
              {STAGES.map((stage, i) => {
                const currentIdx = STAGES.findIndex((s) => s.id === (progress?.stage ?? "preparing"));
                const state = i < currentIdx ? "done" : i === currentIdx ? "active" : "pending";
                return (
                  <div key={stage.id} className="flex-1">
                    <div
                      className="h-1 rounded-full"
                      style={{
                        background:
                          state === "pending" ? "var(--color-bg)" : "var(--color-accent)",
                        opacity: state === "done" ? 0.45 : 1,
                        border: state === "pending" ? "1px solid var(--color-border)" : "none",
                      }}
                    />
                    <p
                      className="mt-1.5 text-[10px] uppercase tracking-widest text-center"
                      style={{ color: state === "active" ? "var(--color-ink)" : "var(--color-muted)", fontWeight: state === "active" ? 600 : 400 }}
                    >
                      {stage.label}
                    </p>
                  </div>
                );
              })}
            </div>

            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                {progress?.stageLabel ?? "Preparing sweep"}
                <span className="royalty-live-dot ml-2 inline-block w-2 h-2 rounded-full align-middle" style={{ background: "var(--color-accent)" }} />
              </p>
              <p className="text-xs" style={{ color: "var(--color-muted)", fontFamily: "var(--font-mono, monospace)" }}>
                {progress?.candidatesFound ?? 0} candidates
              </p>
            </div>

            {/* Platform chips */}
            {progress && Object.keys(progress.platforms).length > 0 && (
              <div className="flex flex-wrap gap-2">
                {Object.entries(progress.platforms).map(([id, p]) => (
                  <span
                    key={id}
                    className="text-xs px-2 py-1 rounded flex items-center gap-1.5"
                    style={{
                      border: "1px solid var(--color-border)",
                      background: "var(--color-bg)",
                      color: p.status === "pending" ? "var(--color-muted)" : "var(--color-ink)",
                    }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{
                        background:
                          p.status === "done"
                            ? "#2d7a4f"
                            : p.status === "sweeping"
                              ? "var(--color-accent)"
                              : "var(--color-border)",
                      }}
                    />
                    {PLATFORM_LABELS[id] ?? id}
                    {p.candidates !== null && ` · ${p.candidates}`}
                  </span>
                ))}
              </div>
            )}

            {/* Activity feed */}
            {progress && progress.log.length > 0 && (
              <div
                className="rounded p-3 space-y-1 max-h-56 overflow-y-auto text-xs"
                style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", fontFamily: "var(--font-mono, monospace)" }}
              >
                {progress.log.slice(-14).map((entry, i) => (
                  <p key={`${entry.at}-${i}`} style={{ color: "var(--color-muted)" }}>
                    <span style={{ opacity: 0.6 }}>{formatClock(entry.at)}</span> {entry.text}
                  </p>
                ))}
              </div>
            )}
          </div>
          <p className="text-xs text-center" style={{ color: "var(--color-muted)" }}>
            Sweeps take a few minutes. You can leave — we&apos;ll notify you when it settles.
          </p>
        </section>
      )}

      {/* ── Error ── */}
      {trial.status === "error" && (
        <section
          className="rounded p-5 space-y-3"
          style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
        >
          <p className="text-sm font-medium" style={{ color: "var(--color-accent)" }}>
            The sweep didn&apos;t finish
          </p>
          <p className="text-xs" style={{ color: "var(--color-muted)" }}>
            {trial.error ?? "Something interrupted the sweep."} This run was not counted against
            your allowance.
          </p>
          <button
            onClick={() => void retry()}
            disabled={busy}
            className="text-sm px-4 py-2 rounded"
            style={{ border: "1px solid var(--color-border)", color: "var(--color-ink)", opacity: busy ? 0.6 : 1 }}
          >
            Start a fresh trial
          </button>
        </section>
      )}

      {/* ── Complete: results ── */}
      {trial.status === "complete" && (
        <>
          <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Candidates analysed", value: String(trial.candidatesAnalysed) },
              { label: "Platforms swept", value: String(trial.platformsChecked) },
              { label: "Hits flagged", value: String(trial.hitsFound) },
              { label: "Adjudicator", value: trial.aiProvider === "ai" ? "AI" : "Heuristic" },
            ].map((card) => (
              <div
                key={card.label}
                className="rounded p-4"
                style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
              >
                <p className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                  {card.label}
                </p>
                <p className="mt-1 text-xl font-semibold" style={{ color: "var(--color-ink)", fontFamily: "var(--font-mono, monospace)" }}>
                  {card.value}
                </p>
              </div>
            ))}
          </section>

          {!trial.converted && (
            <div
              className="rounded px-4 py-3 text-xs"
              style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", color: "var(--color-muted)" }}
            >
              These results are held for {trial.tmdbName}. If they join Image Vault, everything
              here transfers into their live monitor automatically — nothing you found is lost.
            </div>
          )}

          {trial.hits.length === 0 ? (
            <section
              className="rounded p-8 text-center"
              style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
            >
              <p className="text-lg font-semibold" style={{ color: "#2d7a4f" }}>
                All clear
              </p>
              <p className="mt-2 text-sm max-w-md mx-auto" style={{ color: "var(--color-muted)" }}>
                {trial.candidatesAnalysed} candidate{trial.candidatesAnalysed === 1 ? "" : "s"}{" "}
                analysed and nothing crossed the flagging threshold this sweep. Standing monitoring
                is what catches the one that appears next week.
              </p>
            </section>
          ) : (
            <section className="space-y-3">
              <h2 className="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
                Flagged content
              </h2>
              {trial.hits.map((hit) => {
                const risk = RISK_STYLES[hit.riskLevel];
                return (
                  <div
                    key={hit.id}
                    className="rounded p-4 space-y-3"
                    style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
                  >
                    <div className="flex gap-4">
                      {hit.hasThumbnail && (
                        // eslint-disable-next-line @next/next/no-img-element -- evidence still served from our proxy
                        <img
                          src={`/api/scout/${trial.id}/hits/${hit.id}/thumbnail`}
                          alt="Evidence still"
                          className="rounded object-cover shrink-0"
                          style={{
                            width: 88,
                            height: 88,
                            border: "1px solid var(--color-border)",
                            filter: hit.nsfw ? "blur(12px)" : undefined,
                          }}
                        />
                      )}
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                            {PLATFORM_LABELS[hit.platform] ?? hit.platform}
                          </span>
                          <span className="text-xs uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                            {hit.contentType}
                          </span>
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded uppercase tracking-widest"
                            style={{ background: risk.bg, color: risk.fg }}
                          >
                            {risk.label}
                          </span>
                          {hit.nsfw && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded uppercase tracking-widest"
                              style={{ background: "rgba(188,61,44,0.12)", color: "var(--color-accent)" }}
                            >
                              NSFW
                            </span>
                          )}
                        </div>
                        {hit.authorHandle && (
                          <p className="text-xs truncate" style={{ color: "var(--color-muted)" }}>
                            @{hit.authorHandle.replace(/^@/, "")}
                          </p>
                        )}
                        {hit.aiRationale && (
                          <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                            {hit.aiRationale}
                          </p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-2xl font-semibold" style={{ color: "var(--color-ink)", fontFamily: "var(--font-mono, monospace)" }}>
                          {hit.confidence}%
                        </p>
                        <p className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                          Match confidence
                        </p>
                        <p className="mt-1 text-xs" style={{ color: "var(--color-muted)", fontFamily: "var(--font-mono, monospace)" }}>
                          AI-gen {hit.aiGeneratedLikelihood}%
                        </p>
                      </div>
                    </div>

                    {/* Detector readings — null renders as "not measured" */}
                    {hit.detectorReadings && (
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: "var(--color-muted)", fontFamily: "var(--font-mono, monospace)" }}>
                        <span>
                          face{" "}
                          {hit.detectorReadings.faceEmbeddingSimilarity !== null
                            ? hit.detectorReadings.faceEmbeddingSimilarity.toFixed(2)
                            : "—"}
                        </span>
                        <span>
                          synth{" "}
                          {hit.detectorReadings.syntheticMediaScore !== null
                            ? hit.detectorReadings.syntheticMediaScore.toFixed(2)
                            : "—"}
                        </span>
                        {hit.detectorReadings.synthetic?.generatorFamily && (
                          <span>resembles {hit.detectorReadings.synthetic.generatorFamily}</span>
                        )}
                      </div>
                    )}

                    {hit.matchSignals.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {hit.matchSignals.slice(0, 4).map((signal) => (
                          <span
                            key={signal}
                            className="text-[10px] px-1.5 py-0.5 rounded"
                            style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-muted)" }}
                          >
                            {signal}
                          </span>
                        ))}
                      </div>
                    )}

                    <a
                      href={hit.contentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block text-xs underline"
                      style={{ color: "var(--color-accent)" }}
                    >
                      View content ↗
                    </a>
                  </div>
                );
              })}
            </section>
          )}
        </>
      )}
    </div>
  );
}

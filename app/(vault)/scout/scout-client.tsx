"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface ScoutCandidate {
  id: number;
  name: string;
  profileImageUrl: string | null;
  knownFor: Array<{ title: string; year: string; type: "movie" | "tv" }>;
  popularity: number;
}

interface TrialQuota {
  limit: number;
  used: number;
  remaining: number;
  extraGranted: number;
}

interface TrialListItem {
  id: string;
  tmdbId: number;
  tmdbName: string;
  tmdbProfileUrl: string | null;
  status: "draft" | "running" | "complete" | "error";
  hitsFound: number;
  candidatesAnalysed: number;
  coverageTier: string | null;
  converted: boolean;
  createdAt: number;
  completedAt: number | null;
}

interface ScoutPayload {
  enabled: boolean;
  quota: TrialQuota;
  trials: TrialListItem[];
  /** Admin accounts run uncapped — the quota meter becomes informational. */
  unlimited?: boolean;
}

const STATUS_LABELS: Record<TrialListItem["status"], { label: string; color: string }> = {
  draft: { label: "Draft", color: "var(--color-muted)" },
  running: { label: "Sweeping…", color: "#b8860b" },
  complete: { label: "Complete", color: "#2d7a4f" },
  error: { label: "Failed", color: "var(--color-accent)" },
};

function Headshot({ url, name, size }: { url: string | null; name: string; size: number }) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- TMDB headshots skip the optimizer, matching the rest of the app
      <img
        src={url}
        alt={name}
        className="rounded-full object-cover shrink-0"
        style={{ width: size, height: size, border: "1px solid var(--color-border)" }}
      />
    );
  }
  return (
    <div
      className="rounded-full flex items-center justify-center shrink-0 text-sm font-semibold"
      style={{
        width: size,
        height: size,
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        color: "var(--color-muted)",
      }}
    >
      {name
        .split(" ")
        .slice(0, 2)
        .map((p) => p[0] ?? "")
        .join("")}
    </div>
  );
}

export default function ScoutClient() {
  const router = useRouter();
  const [data, setData] = useState<ScoutPayload | null>(null);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<ScoutCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/scout");
    if (!res.ok) return;
    setData((await res.json()) as ScoutPayload);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Debounced TMDB search, same rhythm as onboarding's identity search.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setCandidates([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/scout/search?q=${encodeURIComponent(q)}`);
          if (res.ok) {
            const payload = (await res.json()) as { candidates: ScoutCandidate[] };
            setCandidates(payload.candidates);
          }
        } finally {
          setSearching(false);
        }
      })();
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const startTrial = useCallback(
    async (candidate: ScoutCandidate) => {
      setCreating(candidate.id);
      setError(null);
      try {
        const res = await fetch("/api/scout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tmdbId: candidate.id,
            name: candidate.name,
            profileImageUrl: candidate.profileImageUrl,
            knownFor: candidate.knownFor,
            popularity: candidate.popularity,
          }),
        });
        const payload = (await res.json().catch(() => ({}))) as { trialId?: string; error?: string };
        if (!res.ok || !payload.trialId) {
          setError(payload.error ?? "Could not open the trial");
          return;
        }
        router.push(`/scout/${payload.trialId}`);
      } finally {
        setCreating(null);
      }
    },
    [router]
  );

  if (!data) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-10 text-sm" style={{ color: "var(--color-muted)" }}>
        Loading Image Scout…
      </div>
    );
  }

  if (!data.enabled) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
          Image Scout
        </h1>
        <p className="mt-2 text-sm" style={{ color: "var(--color-muted)" }}>
          Trial sweeps are currently switched off. Check back soon.
        </p>
      </div>
    );
  }

  const { quota } = data;
  const quotaDots = Array.from({ length: Math.min(quota.limit, 12) }, (_, i) => i < quota.used);

  return (
    <div className="max-w-4xl mx-auto px-6 py-10 space-y-10">
      {/* Hero */}
      <div>
        <p className="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
          Image Scout
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
          Run the likeness monitor on any actor
        </h1>
        <p className="mt-2 text-sm max-w-2xl" style={{ color: "var(--color-muted)" }}>
          Pick an actor, add reference photos if you have them, and watch the same sweep our talent
          run — live platform discovery, face verification, synthetic-media analysis and AI
          adjudication. If they join Image Vault later, everything you find transfers straight into
          their monitor.
        </p>
      </div>

      {error && (
        <div className="text-xs px-3 py-2 rounded" style={{ background: "var(--color-surface)", color: "var(--color-accent)" }}>
          {error}
        </div>
      )}

      {/* Quota */}
      <section
        className="rounded p-4 flex items-center justify-between gap-4 flex-wrap"
        style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
      >
        <div>
          <p className="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
            Trial runs
          </p>
          <p className="mt-1 text-sm" style={{ color: "var(--color-ink)" }}>
            {data.unlimited ? (
              <>
                Admin account — runs are not capped. {quota.used} run{quota.used === 1 ? "" : "s"} so
                far; spend still counts against the Apify ceiling.
              </>
            ) : quota.remaining > 0 ? (
              <>
                <span className="font-semibold">{quota.remaining}</span> of {quota.limit} run
                {quota.limit === 1 ? "" : "s"} remaining
              </>
            ) : (
              "All trial runs used — get in touch and we'll open more."
            )}
          </p>
        </div>
        {!data.unlimited && (
          <div className="flex items-center gap-1.5">
            {quotaDots.map((used, i) => (
              <span
                key={i}
                className="w-3 h-3 rounded-full"
                style={{
                  background: used ? "var(--color-accent)" : "transparent",
                  border: "1.5px solid " + (used ? "var(--color-accent)" : "var(--color-border)"),
                }}
              />
            ))}
          </div>
        )}
      </section>

      {/* Search */}
      <section className="space-y-3">
        <h2 className="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
          Pick a subject
        </h2>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search any actor — try a client, or someone you're casting"
          className="w-full text-sm px-4 py-3 rounded"
          style={{
            border: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            color: "var(--color-ink)",
          }}
        />
        {searching && (
          <p className="text-xs" style={{ color: "var(--color-muted)" }}>
            Searching…
          </p>
        )}
        {candidates.length > 0 && (
          <div className="rounded divide-y" style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
            {candidates.map((c) => (
              <button
                key={c.id}
                onClick={() => void startTrial(c)}
                disabled={creating !== null}
                className="w-full flex items-center gap-4 px-4 py-3 text-left transition hover:bg-black/[0.03]"
                style={{ opacity: creating !== null && creating !== c.id ? 0.5 : 1, borderColor: "var(--color-border)" }}
              >
                <Headshot url={c.profileImageUrl} name={c.name} size={44} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink)" }}>
                    {c.name}
                  </p>
                  {c.knownFor.length > 0 && (
                    <p className="text-xs truncate" style={{ color: "var(--color-muted)" }}>
                      {c.knownFor.map((k) => `${k.title}${k.year ? ` (${k.year})` : ""}`).join(" · ")}
                    </p>
                  )}
                </div>
                <span className="text-xs shrink-0" style={{ color: "var(--color-accent)" }}>
                  {creating === c.id ? "Opening…" : "Start trial →"}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Existing trials */}
      {data.trials.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
            Your trials
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {data.trials.map((t) => {
              const status = STATUS_LABELS[t.status];
              return (
                <button
                  key={t.id}
                  onClick={() => router.push(`/scout/${t.id}`)}
                  className="rounded p-4 text-left transition hover:bg-black/[0.02] flex items-center gap-4"
                  style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
                >
                  <Headshot url={t.tmdbProfileUrl} name={t.tmdbName} size={44} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: "var(--color-ink)" }}>
                      {t.tmdbName}
                      {t.converted && (
                        <span
                          className="ml-2 text-[10px] px-1.5 py-0.5 rounded uppercase tracking-widest align-middle"
                          style={{ background: "rgba(45,122,79,0.12)", color: "#2d7a4f" }}
                        >
                          Onboarded
                        </span>
                      )}
                    </p>
                    <p className="text-xs" style={{ color: status.color }}>
                      {status.label}
                      {t.status === "complete" && (
                        <span style={{ color: "var(--color-muted)" }}>
                          {" "}
                          · {t.hitsFound} hit{t.hitsFound === 1 ? "" : "s"} from {t.candidatesAnalysed}{" "}
                          candidates
                        </span>
                      )}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

interface SampleHit {
  hitId: string;
  contentUrl: string;
  authorHandle: string | null;
  detectedAt: number;
}

interface Candidate {
  tmdbId: number;
  name: string;
  profileUrl: string | null;
  hitCount: number;
  lastSeen: number;
  sampleHits: SampleHit[];
}

function when(unix: number): string {
  const diff = Math.floor(Date.now() / 1000) - unix;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function FunnelCandidatesClient() {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);

  useEffect(() => {
    // Inline the fetch so React's set-state-in-effect linter can see the
    // await boundary before the setState. Cancellation guard prevents a
    // late response from setting state after unmount.
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/admin/monitor/funnel-candidates");
      if (cancelled || !res.ok) return;
      const data = (await res.json()) as { candidates: Candidate[] };
      if (!cancelled) setCandidates(data.candidates);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
          Funnel candidates
        </h2>
        <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
          Actors we&apos;ve identified in AI hits but who aren&apos;t on ImageVault yet. Ranked by how often
          they show up. Every row is a real outreach pitch: &ldquo;we&apos;ve catalogued N pieces
          featuring you, join us and we file the takedowns.&rdquo;
        </p>
      </div>

      {candidates === null ? (
        <div className="text-xs" style={{ color: "var(--color-muted)" }}>
          Loading…
        </div>
      ) : candidates.length === 0 ? (
        <div
          className="rounded p-6 text-sm text-center"
          style={{ border: "1px dashed var(--color-border)", color: "var(--color-muted)" }}
        >
          No non-onboarded actors identified yet. When face-embedding detection lands or admins seed
          secondary actors on hits, this list populates automatically.
        </div>
      ) : (
        <ul className="space-y-3">
          {candidates.map((c) => (
            <li
              key={c.tmdbId}
              className="rounded p-4 flex gap-4"
              style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
            >
              <Avatar name={c.name} profileUrl={c.profileUrl} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
                      {c.name}
                    </h3>
                    <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                      TMDB {c.tmdbId} · most recent {when(c.lastSeen)}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-semibold" style={{ color: "var(--color-accent)" }}>
                      {c.hitCount}
                    </div>
                    <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
                      hits
                    </div>
                  </div>
                </div>

                {c.sampleHits.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <p
                      className="text-[10px] uppercase tracking-widest font-semibold"
                      style={{ color: "var(--color-muted)" }}
                    >
                      Recent
                    </p>
                    <ul className="space-y-0.5">
                      {c.sampleHits.map((s) => (
                        <li key={s.hitId} className="text-xs flex gap-2 items-baseline">
                          <span style={{ color: "var(--color-muted)" }}>
                            {s.authorHandle ?? "(no handle)"} · {when(s.detectedAt)} ·
                          </span>
                          <a
                            href={s.contentUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="truncate underline underline-offset-2"
                            style={{ color: "var(--color-accent)" }}
                          >
                            {s.contentUrl.replace(/^https?:\/\//, "")}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Avatar({ name, profileUrl }: { name: string; profileUrl: string | null }) {
  const [broken, setBroken] = useState(false);
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  const show = profileUrl && !broken;

  return (
    <div
      className="h-14 w-14 shrink-0 rounded-full overflow-hidden"
      style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)" }}
    >
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={profileUrl!}
          alt={name}
          className="h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center text-sm font-semibold"
          style={{ color: "var(--color-muted)" }}
        >
          {initials || "?"}
        </div>
      )}
    </div>
  );
}

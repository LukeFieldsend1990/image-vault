"use client";

/**
 * Loader + scope switcher around the shared deepfake statistics report.
 *
 * All three surfaces (union, rep, admin) differ only in which endpoint they
 * read and what the header says, so they share this shell: one fetch, one
 * error path, one scope switcher. The report body itself lives in
 * ./deepfake-stats.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import DeepfakeStats, { type DeepfakeStatsPayload } from "./deepfake-stats";

export default function DeepfakeStatsPanel({
  endpoint,
  eyebrow,
  title,
  intro,
  backHref,
  backLabel,
  /** Renders as a page (own header) or as a section inside a longer console. */
  variant = "page",
}: {
  endpoint: string;
  eyebrow?: string;
  title: string;
  intro?: string;
  backHref?: string;
  backLabel?: string;
  variant?: "page" | "section";
}) {
  const [data, setData] = useState<DeepfakeStatsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (unionId?: string | null) => {
      setLoading(true);
      try {
        // undefined = let the server pick the default scope; null = the admin's
        // explicit platform-wide scope, which is the bare endpoint too.
        const url =
          unionId == null ? endpoint : `${endpoint}?unionId=${encodeURIComponent(unionId)}`;
        const res = await fetch(url);
        const d = (await res.json()) as DeepfakeStatsPayload & { error?: string };
        if (!res.ok || d.error) {
          setError(d.error ?? `Failed to load (${res.status})`);
        } else {
          setData(d);
          setError(null);
        }
      } catch {
        setError("Failed to load statistics.");
      } finally {
        setLoading(false);
      }
    },
    [endpoint],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const scope = data?.scope;
  const options = scope?.available ?? [];
  // Admin may look at every talent on the platform as well as at each union's
  // slice; a union watcher only ever switches between unions they hold.
  const showAll = scope?.kind === "admin";
  const showSwitcher = options.length > 1 || showAll;

  const Header = (
    <div className={variant === "page" ? "mb-6" : "mb-4"}>
      {eyebrow && (
        <p
          className="text-[10px] uppercase tracking-widest font-semibold mb-1"
          style={{ color: "var(--color-accent)" }}
        >
          {eyebrow}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        {variant === "page" ? (
          <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>
            {title}
          </h1>
        ) : (
          <h2 className="text-lg font-semibold" style={{ color: "var(--color-ink)" }}>
            {title}
          </h2>
        )}
        {backHref && (
          <Link
            href={backHref}
            className="text-xs font-medium underline underline-offset-2 shrink-0"
            style={{ color: "var(--color-muted)" }}
          >
            {backLabel ?? "← Back"}
          </Link>
        )}
      </div>
      {intro && (
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          {intro}
        </p>
      )}
      {scope?.roster && scope.roster.total > 0 && (
        <p className="text-xs mt-1.5" style={{ color: "var(--color-muted)" }}>
          {scope.roster.onPlatform} of {scope.roster.total} roster members are on ImageVault (
          {scope.roster.coveragePct}%). Members who are not are outside the monitor and contribute
          nothing to these counts.
        </p>
      )}
    </div>
  );

  return (
    <div>
      {Header}

      {showSwitcher && (
        <div className="mb-5 flex flex-wrap gap-1.5">
          {showAll && (
            <ScopeChip
              label="All talent"
              active={!scope?.unionId}
              onClick={() => void load(null)}
            />
          )}
          {options.map((o) => (
            <ScopeChip
              key={o.id}
              label={o.shortName}
              active={scope?.unionId === o.id}
              onClick={() => void load(o.id)}
            />
          ))}
        </div>
      )}

      {error && (
        <p className="text-sm" style={{ color: "var(--color-accent)" }}>
          {error}
        </p>
      )}
      {loading && !data && (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          Loading…
        </p>
      )}
      {data && (
        <div style={{ opacity: loading ? 0.5 : 1, transition: "opacity 120ms" }}>
          <DeepfakeStats scope={data.scope} stats={data.stats} />
        </div>
      )}
    </div>
  );
}

function ScopeChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-full px-3 py-1 text-xs font-medium"
      style={{
        border: "1px solid var(--color-border)",
        background: active ? "var(--color-accent)" : "var(--color-surface)",
        color: active ? "#fff" : "var(--color-muted)",
      }}
    >
      {label}
    </button>
  );
}

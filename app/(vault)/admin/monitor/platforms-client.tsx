"use client";

import { useCallback, useEffect, useState } from "react";

interface PlatformRow {
  id: string;
  name: string;
  category: string;
  source: "apify" | "youtube_api" | "civitai";
  enabled: boolean;
  defaultEnabled: boolean;
  configured: boolean;
}

const SOURCE_LABELS: Record<PlatformRow["source"], string> = {
  apify: "Apify (paid, shared ceiling)",
  youtube_api: "YouTube Data API (free quota)",
  civitai: "Civitai public API (free)",
};

export default function PlatformsClient() {
  const [platforms, setPlatforms] = useState<PlatformRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/monitor/platforms");
    if (!res.ok) return;
    const data = (await res.json()) as { platforms: PlatformRow[] };
    setPlatforms(data.platforms);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(
    async (platform: PlatformRow) => {
      setBusyId(platform.id);
      setMessage(null);
      try {
        const res = await fetch("/api/admin/monitor/platforms", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ platformId: platform.id, enabled: !platform.enabled }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          setMessage(err.error ?? "Update failed");
          return;
        }
        setMessage(`${platform.name} ${platform.enabled ? "disabled" : "enabled"}`);
        await load();
      } finally {
        setBusyId(null);
      }
    },
    [load]
  );

  if (!platforms) {
    return (
      <section className="text-xs" style={{ color: "var(--color-muted)" }}>
        Loading platform coverage…
      </section>
    );
  }

  const enabledCount = platforms.filter((p) => p.enabled).length;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
          Platform coverage
        </h2>
        <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
          Which surfaces every sweep covers — {enabledCount} of {platforms.length} on. Newly wired
          platforms ship off by default while the detector is in testing; enabling one applies to
          every talent&apos;s next sweep. Apify-backed surfaces share the discovery spend ceiling
          below.
        </p>
      </div>

      {message && (
        <div
          className="text-xs px-3 py-2 rounded"
          style={{ background: "var(--color-surface)", color: "var(--color-muted)" }}
        >
          {message}
        </div>
      )}

      <div
        className="rounded p-4 space-y-3"
        style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
      >
        {platforms.map((platform, i) => (
          <div key={platform.id}>
            {i > 0 && <hr className="mb-3" style={{ borderColor: "var(--color-border)" }} />}
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                  {platform.name}
                  <span
                    className="ml-2 text-xs font-normal uppercase tracking-widest"
                    style={{ color: "var(--color-muted)" }}
                  >
                    {platform.category}
                  </span>
                </p>
                <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                  {SOURCE_LABELS[platform.source]}
                  {!platform.configured && " — credential missing, runs simulated only"}
                </p>
              </div>
              <button
                onClick={() => void toggle(platform)}
                disabled={busyId !== null}
                className="text-xs px-3 py-1.5 rounded shrink-0"
                style={{
                  background: platform.enabled ? "var(--color-accent)" : "var(--color-surface)",
                  color: platform.enabled ? "white" : "var(--color-muted)",
                  border: platform.enabled ? "none" : "1px solid var(--color-border)",
                  opacity: busyId === platform.id ? 0.6 : 1,
                }}
              >
                {platform.enabled ? "On" : "Off"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

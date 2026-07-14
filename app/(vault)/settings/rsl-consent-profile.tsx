"use client";

import { useEffect, useState } from "react";
import { HUMAN_CONSENT_REGISTRY_URL, REGISTRY_ELIGIBILITY_NOTE } from "@/lib/rsl/registry";

type Light = "red" | "amber" | "green";
type Status = "not_published" | "awaiting_approval" | "live" | "blocked_vault_locked";

interface CategoryPosture {
  id: string;
  name: string;
  regimeTag: string | null;
  light: Light;
  rslUsage: string | null;
}
interface ProfileVM {
  publishOptIn: boolean;
  adminApproved: boolean;
  displayName: string | null;
  profession: string | null;
  links: { label: string; url: string }[];
  humanConsentId: string | null;
  hcrDiverged: boolean;
  status: Status;
  publicUrl: string | null;
  posture: { categories: CategoryPosture[]; overall: Light };
}

const LIGHT: Record<Light, { label: string; colour: string; dot: string }> = {
  green: { label: "Permitted", colour: "#166534", dot: "#16a34a" },
  amber: { label: "Permitted with terms", colour: "#b45309", dot: "#d97706" },
  red: { label: "Prohibited", colour: "#991b1b", dot: "#dc2626" },
};

const STATUS_COPY: Record<Status, { text: string; colour: string }> = {
  not_published: { text: "Not published", colour: "var(--color-muted)" },
  awaiting_approval: { text: "Opted in — awaiting ImageVault admin approval", colour: "#b45309" },
  live: { text: "Live", colour: "#166534" },
  blocked_vault_locked: { text: "Hidden — your vault is locked", colour: "#991b1b" },
};

export default function RslConsentProfile() {
  const [vm, setVm] = useState<ProfileVM | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [profession, setProfession] = useState("");
  const [hcid, setHcid] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/rsl/profile");
        const d = (await r.json()) as ProfileVM & { error?: string };
        if (cancelled) return;
        if (!r.ok) { setError(d.error ?? "Could not load."); return; }
        setVm(d);
        setDisplayName(d.displayName ?? "");
        setProfession(d.profession ?? "");
      } catch {
        if (!cancelled) setError("Network error.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function patch(body: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch("/api/rsl/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = (await r.json()) as ProfileVM & { error?: string };
      if (!r.ok) { setError(d.error ?? "Could not save."); return; }
      setVm(d);
    } catch {
      setError("Network error.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded border p-5 mb-6" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <p className="text-sm py-2" style={{ color: "var(--color-muted)" }}>Loading consent profile…</p>
      </div>
    );
  }
  if (!vm) {
    return (
      <div className="rounded border p-5 mb-6" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <p className="text-xs" style={{ color: "var(--color-accent)" }}>{error ?? "Could not load consent profile."}</p>
      </div>
    );
  }

  const overall = LIGHT[vm.posture.overall];
  const status = STATUS_COPY[vm.status];
  const liveCats = vm.posture.categories.filter((c) => c.rslUsage !== null);

  return (
    <div className="rounded border p-5 mb-6" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
      <h2 className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "var(--color-muted)" }}>
        Public Consent Profile
      </h2>
      <p className="text-xs mb-4" style={{ color: "var(--color-muted)", lineHeight: 1.5 }}>
        Publish a machine-readable AI-consent posture (the RSL standard / Human Consent Registry stoplight) so AI
        systems can read your terms. Your stoplight is set by your Standing Instructions above. Nothing goes public
        until you opt in <strong>and</strong> an ImageVault admin approves it.
      </p>

      {/* Posture preview */}
      <div className="rounded-lg p-3 mb-4" style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)" }}>
        <div className="flex items-center gap-2 mb-2.5">
          <span className="inline-block rounded-full" style={{ width: 10, height: 10, background: overall.dot }} />
          <span className="text-sm font-medium" style={{ color: overall.colour }}>AI use: {overall.label}</span>
          <span className="ml-auto text-[11px]" style={{ color: status.colour }}>{saving ? "Saving…" : status.text}</span>
        </div>
        <div className="space-y-1.5">
          {liveCats.map((c) => {
            const l = LIGHT[c.light];
            return (
              <div key={c.id} className="flex items-center gap-2 text-xs">
                <span className="inline-block rounded-full" style={{ width: 8, height: 8, background: l.dot }} />
                <span style={{ color: "var(--color-text)" }}>{c.name}</span>
                {c.regimeTag && (
                  <span className="text-[10px] font-mono px-1 py-0.5 rounded" style={{ background: "var(--color-surface)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}>{c.regimeTag}</span>
                )}
                <span className="ml-auto font-medium" style={{ color: l.colour }}>{l.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {vm.publicUrl && (
        <p className="text-xs mb-4" style={{ color: "var(--color-muted)" }}>
          Live at{" "}
          <a href={vm.publicUrl} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "var(--color-accent)" }}>
            {vm.publicUrl.replace(/^https?:\/\//, "")}
          </a>
        </p>
      )}

      {/* Opt-in toggle */}
      <label className="flex items-start gap-3 cursor-pointer mb-4">
        <input
          type="checkbox"
          checked={vm.publishOptIn}
          disabled={saving}
          onChange={(e) => patch({ publishOptIn: e.target.checked })}
          className="mt-0.5"
        />
        <span className="text-sm" style={{ color: "var(--color-text)" }}>
          Publish my consent profile
          <span className="block text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
            Opt in to a public, unlisted consent page + RSL license document. An admin must approve before it goes live.
          </span>
        </span>
      </label>

      {/* Public-card fields */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] font-medium block mb-1" style={{ color: "var(--color-muted)" }}>Display name</label>
          <input
            type="text"
            value={displayName}
            placeholder="Shown on your public profile"
            onChange={(e) => setDisplayName(e.target.value)}
            onBlur={() => { if (displayName !== (vm.displayName ?? "")) patch({ displayName }); }}
            className="w-full rounded px-2.5 py-1.5 text-sm"
            style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" }}
          />
        </div>
        <div>
          <label className="text-[11px] font-medium block mb-1" style={{ color: "var(--color-muted)" }}>Profession</label>
          <input
            type="text"
            value={profession}
            placeholder="e.g. Actor"
            onChange={(e) => setProfession(e.target.value)}
            onBlur={() => { if (profession !== (vm.profession ?? "")) patch({ profession }); }}
            className="w-full rounded px-2.5 py-1.5 text-sm"
            style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" }}
          />
        </div>
      </div>
      <p className="text-[11px] mt-2" style={{ color: "var(--color-muted)" }}>
        Only a name, profession and links are ever shown publicly — never any scan or biometric data.
      </p>

      {/* Human Consent Registry bridge */}
      <div className="mt-5 pt-4" style={{ borderTop: "1px solid var(--color-border)" }}>
        <p className="text-[11px] font-semibold uppercase tracking-widest mb-1" style={{ color: "var(--color-muted)" }}>
          Human Consent Registry
        </p>
        {vm.humanConsentId ? (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-medium px-2 py-1 rounded" style={{ background: "rgba(1,180,228,0.12)", color: "#0e7490" }}>
              Linked · {vm.humanConsentId}
            </span>
            <button
              type="button"
              disabled={saving}
              onClick={() => { patch({ humanConsentId: null }); }}
              className="text-[11px] underline"
              style={{ color: "var(--color-muted)" }}
            >
              Remove
            </button>
            {vm.hcrDiverged && (
              <div className="w-full mt-2 rounded px-3 py-2 text-xs" style={{ background: "rgba(180,83,9,0.08)", border: "1px solid rgba(180,83,9,0.3)", color: "#b45309", lineHeight: 1.5 }}>
                <strong>Posture mismatch.</strong> Your ImageVault consent posture has changed since you linked this HCR ID. Your listing on the Human Consent Registry may no longer reflect your current stance — please update it at{" "}
                <a href="https://registry.rslmedia.org/" target="_blank" rel="noopener noreferrer" className="underline">registry.rslmedia.org</a>.
              </div>
            )}
            <span className="w-full text-xs mt-1" style={{ color: "var(--color-muted)" }}>
              Your Human Consent ID is shown as a verified badge on your public consent profile.
            </span>
          </div>
        ) : (
          <>
            <p className="text-xs mb-2" style={{ color: "var(--color-muted)", lineHeight: 1.5 }}>
              Get a portable <strong>Human Consent ID</strong> from RSL Media&apos;s registry and show it on your
              profile. Register there, set the same stoplight (<strong>AI use: {overall.label}</strong>), then paste
              your ID back here.
            </p>
            <a
              href={HUMAN_CONSENT_REGISTRY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium mb-2"
              style={{ color: "var(--color-accent)" }}
            >
              Open the Human Consent Registry ↗
            </a>
            <div className="flex gap-2">
              <input
                type="text"
                value={hcid}
                placeholder="Paste your Human Consent ID"
                onChange={(e) => setHcid(e.target.value)}
                className="flex-1 rounded px-2.5 py-1.5 text-sm"
                style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" }}
              />
              <button
                type="button"
                disabled={saving || !hcid.trim()}
                onClick={() => { patch({ humanConsentId: hcid.trim() }); setHcid(""); }}
                className="rounded px-3 py-1.5 text-xs font-medium text-white"
                style={{ background: "var(--color-accent)", opacity: hcid.trim() ? 1 : 0.5 }}
              >
                Link
              </button>
            </div>
            <p className="text-[11px] mt-2" style={{ color: "var(--color-muted)" }}>{REGISTRY_ELIGIBILITY_NOTE}</p>
          </>
        )}
      </div>

      {error && <p className="text-xs mt-3" style={{ color: "var(--color-accent)" }}>{error}</p>}
    </div>
  );
}

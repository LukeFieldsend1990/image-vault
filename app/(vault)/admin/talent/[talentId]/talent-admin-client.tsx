"use client";

import { useState, useEffect } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface TalentSettings {
  pipelineEnabled: boolean;
  talentSharePct: number;
  agencySharePct: number;
  platformSharePct: number;
}

interface Permission {
  licenceType: string;
  permission: "allowed" | "approval_required" | "blocked";
}

interface Rep {
  repId: string;
  email: string;
  linkedSince: number;
}

// ── Settings Tab ───────────────────────────────────────────────────────────────

function SettingsTab({ talentId, initial }: { talentId: string; initial: TalentSettings }) {
  const [pipelineEnabled, setPipelineEnabled] = useState(initial.pipelineEnabled);
  const [talentPct, setTalentPct] = useState(String(initial.talentSharePct));
  const [agencyPct, setAgencyPct] = useState(String(initial.agencySharePct));
  const [platformPct, setPlatformPct] = useState(String(initial.platformSharePct));
  const [savingPipeline, setSavingPipeline] = useState(false);
  const [savingSplit, setSavingSplit] = useState(false);
  const [pipelineMsg, setPipelineMsg] = useState<string | null>(null);
  const [splitMsg, setSplitMsg] = useState<string | null>(null);

  const t = Number(talentPct) || 0;
  const a = Number(agencyPct) || 0;
  const p = Number(platformPct) || 0;
  const sum = t + a + p;
  const splitValid = sum === 100 && Number.isInteger(t) && Number.isInteger(a) && Number.isInteger(p);

  async function togglePipeline() {
    setSavingPipeline(true);
    setPipelineMsg(null);
    const next = !pipelineEnabled;
    try {
      const res = await fetch(`/api/admin/talent/${talentId}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipelineEnabled: next }),
      });
      if (res.ok) {
        setPipelineEnabled(next);
        setPipelineMsg(next ? "Pipeline enabled." : "Pipeline disabled.");
      } else {
        const data = await res.json() as { error?: string };
        setPipelineMsg(data.error ?? "Save failed.");
      }
    } catch {
      setPipelineMsg("Save failed.");
    } finally {
      setSavingPipeline(false);
    }
  }

  async function saveSplit() {
    if (!splitValid) return;
    setSavingSplit(true);
    setSplitMsg(null);
    try {
      const res = await fetch(`/api/admin/talent/${talentId}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ talentSharePct: t, agencySharePct: a, platformSharePct: p }),
      });
      if (res.ok) {
        setSplitMsg("Split saved.");
      } else {
        const data = await res.json() as { error?: string };
        setSplitMsg(data.error ?? "Save failed.");
      }
    } catch {
      setSplitMsg("Save failed.");
    } finally {
      setSavingSplit(false);
    }
  }

  return (
    <div className="px-8 py-6 space-y-8 max-w-2xl">
      {/* Pipeline toggle */}
      <div className="rounded border p-6" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <h2 className="text-sm font-semibold mb-1" style={{ color: "var(--color-ink)" }}>Pipeline Access</h2>
        <p className="text-xs mb-5" style={{ color: "var(--color-muted)" }}>
          When disabled, this talent cannot start new Digital Double pipeline jobs.
        </p>
        <div className="flex items-center gap-4">
          <button
            onClick={() => void togglePipeline()}
            disabled={savingPipeline}
            className="flex items-center gap-2.5 px-5 py-2.5 rounded text-sm font-medium transition disabled:opacity-50"
            style={{
              background: pipelineEnabled ? "#16653418" : "#99161618",
              color: pipelineEnabled ? "#166534" : "#991b1b",
              border: `1px solid ${pipelineEnabled ? "#166534" : "#991b1b"}`,
            }}
          >
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: pipelineEnabled ? "#166534" : "#991b1b" }}
            />
            {savingPipeline ? "Saving…" : pipelineEnabled ? "Enabled — click to disable" : "Disabled — click to enable"}
          </button>
        </div>
        {pipelineMsg && (
          <p className="mt-3 text-xs" style={{ color: "var(--color-muted)" }}>{pipelineMsg}</p>
        )}
      </div>

      {/* Fee split */}
      <div className="rounded border p-6" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <h2 className="text-sm font-semibold mb-1" style={{ color: "var(--color-ink)" }}>Licence Fee Split</h2>
        <p className="text-xs mb-5" style={{ color: "var(--color-muted)" }}>
          Configure how approved licence fees are distributed. The three values must sum to exactly 100.
        </p>

        <div className="grid grid-cols-3 gap-4 mb-4">
          {[
            { label: "Talent %", value: talentPct, onChange: setTalentPct },
            { label: "Agency %", value: agencyPct, onChange: setAgencyPct },
            { label: "Platform %", value: platformPct, onChange: setPlatformPct },
          ].map(({ label, value, onChange }) => (
            <div key={label}>
              <label className="block text-[10px] uppercase tracking-widest font-semibold mb-1.5" style={{ color: "var(--color-muted)" }}>
                {label}
              </label>
              <input
                type="number"
                min={0}
                max={100}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-full rounded border px-3 py-2 text-sm font-mono focus:outline-none"
                style={{
                  borderColor: "var(--color-border)",
                  background: "var(--color-bg)",
                  color: "var(--color-ink)",
                }}
              />
            </div>
          ))}
        </div>

        {/* Sum indicator */}
        <div className="flex items-center gap-2 mb-4">
          <span
            className="text-xs font-mono"
            style={{ color: splitValid ? "#166534" : sum > 100 ? "#991b1b" : "var(--color-muted)" }}
          >
            Sum: {sum}/100
          </span>
          {!splitValid && sum !== 0 && (
            <span className="text-xs" style={{ color: "#991b1b" }}>
              {sum > 100 ? "Over by " + (sum - 100) : "Under by " + (100 - sum)}
            </span>
          )}
        </div>

        {/* Split bar preview */}
        {splitValid && (
          <div className="flex h-2 rounded-full overflow-hidden gap-px mb-4">
            <div className="h-full" style={{ width: `${t}%`, background: "var(--color-accent)", opacity: 0.9 }} title={`Talent ${t}%`} />
            <div className="h-full" style={{ width: `${a}%`, background: "var(--color-ink)", opacity: 0.5 }} title={`Agency ${a}%`} />
            <div className="h-full" style={{ width: `${p}%`, background: "var(--color-muted)", opacity: 0.4 }} title={`Platform ${p}%`} />
          </div>
        )}

        <button
          onClick={() => void saveSplit()}
          disabled={!splitValid || savingSplit}
          className="px-4 py-2 rounded text-xs font-medium text-white transition disabled:opacity-40"
          style={{ background: "var(--color-accent)" }}
        >
          {savingSplit ? "Saving…" : "Save split"}
        </button>
        {splitMsg && (
          <p className="mt-3 text-xs" style={{ color: "var(--color-muted)" }}>{splitMsg}</p>
        )}
      </div>
    </div>
  );
}

// ── Permissions Tab ────────────────────────────────────────────────────────────

const LICENCE_TYPE_META: { type: string; label: string; description: string }[] = [
  { type: "commercial", label: "Commercial Ads", description: "TV, digital & out-of-home advertising" },
  { type: "film_double", label: "Digital Stunt Double", description: "De-aging, stunt replacement in film" },
  { type: "game_character", label: "Video Game Character", description: "In-engine game character or NPC" },
  { type: "ai_avatar", label: "AI Avatar", description: "Real-time synthetic likeness use" },
  { type: "training_data", label: "Training Datasets", description: "AI model training data inclusion" },
  { type: "monitoring_reference", label: "Deepfake Protection", description: "Monitoring / reference use only" },
];

const PERMISSION_OPTIONS: { value: Permission["permission"]; label: string; color: string }[] = [
  { value: "allowed", label: "Allowed", color: "#166534" },
  { value: "approval_required", label: "Approval Required", color: "#92400e" },
  { value: "blocked", label: "Blocked", color: "#991b1b" },
];

function PermissionsTab({ talentId }: { talentId: string }) {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/roster/${talentId}/permissions`)
      .then((r) => r.json() as Promise<{ permissions: Permission[] }>)
      .then((d) => setPermissions(d.permissions ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [talentId]);

  async function update(licenceType: string, permission: Permission["permission"]) {
    setSaving(licenceType);
    const prev = [...permissions];
    setPermissions((ps) => ps.map((p) => p.licenceType === licenceType ? { ...p, permission } : p));
    try {
      const res = await fetch(`/api/roster/${talentId}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ licenceType, permission }),
      });
      if (!res.ok) setPermissions(prev);
    } catch {
      setPermissions(prev);
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return (
      <div className="px-8 py-6 space-y-3">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-16 rounded border animate-pulse" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }} />
        ))}
      </div>
    );
  }

  const permMap = Object.fromEntries(permissions.map((p) => [p.licenceType, p.permission])) as Record<string, Permission["permission"]>;

  return (
    <div className="px-8 py-6">
      <p className="text-xs mb-5" style={{ color: "var(--color-muted)" }}>
        Control which licence types are available for this talent. Changes take effect immediately for new licence requests.
      </p>
      <div className="space-y-3">
        {LICENCE_TYPE_META.map((meta) => {
          const current = permMap[meta.type] ?? "approval_required";
          const isSaving = saving === meta.type;
          const currentOption = PERMISSION_OPTIONS.find((o) => o.value === current)!;

          return (
            <div
              key={meta.type}
              className="rounded border px-5 py-4"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>{meta.label}</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>{meta.description}</p>
                </div>

                <div
                  className="flex items-center rounded shrink-0 overflow-hidden"
                  style={{ border: "1px solid var(--color-border)" }}
                >
                  {PERMISSION_OPTIONS.map((opt, idx) => {
                    const active = current === opt.value;
                    const isLast = idx === PERMISSION_OPTIONS.length - 1;
                    return (
                      <button
                        key={opt.value}
                        disabled={isSaving}
                        onClick={() => void update(meta.type, opt.value)}
                        className="px-3 py-1.5 text-[11px] font-medium transition"
                        style={{
                          background: active ? `${opt.color}18` : "transparent",
                          color: active ? opt.color : "var(--color-muted)",
                          borderRight: isLast ? "none" : "1px solid var(--color-border)",
                          cursor: isSaving ? "wait" : "pointer",
                          opacity: isSaving && !active ? 0.5 : 1,
                        }}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-2.5 flex items-center gap-1.5">
                <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: currentOption.color }} />
                <span className="text-[11px]" style={{ color: currentOption.color }}>
                  {currentOption.label}
                  {isSaving && " — saving…"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Reps Tab ───────────────────────────────────────────────────────────────────

function ts(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function RepsTab({ talentId }: { talentId: string }) {
  const [reps, setReps] = useState<Rep[]>([]);
  const [loading, setLoading] = useState(true);
  const [unlinking, setUnlinking] = useState<string | null>(null);
  const [addEmail, setAddEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/talent/${talentId}/reps`)
      .then((r) => r.json() as Promise<{ reps: Rep[] }>)
      .then((d) => setReps(d.reps ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [talentId]);

  async function unlink(repId: string) {
    setUnlinking(repId);
    try {
      const res = await fetch(`/api/admin/talent/${talentId}/reps/${repId}`, { method: "DELETE" });
      if (res.ok) {
        setReps((prev) => prev.filter((r) => r.repId !== repId));
      }
    } finally {
      setUnlinking(null);
    }
  }

  async function addRep() {
    if (!addEmail.trim()) return;
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch(`/api/admin/talent/${talentId}/reps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repEmail: addEmail.trim() }),
      });
      const d = await res.json() as { rep?: Rep; error?: string };
      if (!res.ok) throw new Error(d.error ?? "Failed");
      if (d.rep) setReps((prev) => [...prev, d.rep!]);
      setAddEmail("");
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Failed");
    } finally {
      setAdding(false);
    }
  }

  if (loading) {
    return (
      <div className="px-8 py-6 space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-14 rounded border animate-pulse" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }} />
        ))}
      </div>
    );
  }

  return (
    <div className="px-8 py-6">
      <p className="text-xs mb-5" style={{ color: "var(--color-muted)" }}>
        Reps currently managing this talent. Unlinking removes the delegation immediately — the talent remains unaffected.
      </p>

      {/* Add rep */}
      <div className="mb-6 flex items-start gap-2">
        <div className="flex-1">
          <input
            type="email"
            placeholder="Rep email address"
            value={addEmail}
            onChange={(e) => { setAddEmail(e.target.value); setAddError(null); }}
            onKeyDown={(e) => e.key === "Enter" && void addRep()}
            className="w-full rounded border px-3 py-2 text-sm focus:outline-none"
            style={{
              borderColor: addError ? "var(--color-danger)" : "var(--color-border)",
              background: "var(--color-bg)",
              color: "var(--color-ink)",
            }}
          />
          {addError && (
            <p className="mt-1 text-xs" style={{ color: "var(--color-danger)" }}>{addError}</p>
          )}
        </div>
        <button
          onClick={() => void addRep()}
          disabled={adding || !addEmail.trim()}
          className="shrink-0 rounded px-4 py-2 text-sm font-medium text-white transition disabled:opacity-40"
          style={{ background: "var(--color-ink)" }}
        >
          {adding ? "Adding…" : "Add Rep"}
        </button>
      </div>

      {reps.length === 0 ? (
        <div
          className="rounded border px-5 py-8 text-center"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>No reps linked to this talent.</p>
        </div>
      ) : (
        <div className="rounded border overflow-hidden" style={{ borderColor: "var(--color-border)" }}>
          {/* Header */}
          <div
            className="grid text-[10px] uppercase tracking-widest font-semibold px-5 py-3"
            style={{
              gridTemplateColumns: "1fr auto auto",
              color: "var(--color-muted)",
              background: "var(--color-surface)",
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            <span>Rep email</span>
            <span>Linked since</span>
            <span></span>
          </div>

          {reps.map((rep) => (
            <div
              key={rep.repId}
              className="grid items-center px-5 py-3.5 border-b last:border-0"
              style={{
                gridTemplateColumns: "1fr auto auto",
                borderColor: "var(--color-border)",
                gap: "1rem",
              }}
            >
              <span className="text-sm truncate" style={{ color: "var(--color-ink)" }}>{rep.email}</span>
              <span className="text-xs" style={{ color: "var(--color-muted)" }}>{ts(rep.linkedSince)}</span>
              <button
                onClick={() => void unlink(rep.repId)}
                disabled={unlinking === rep.repId}
                className="text-xs font-medium px-3 py-1.5 rounded border transition disabled:opacity-40"
                style={{ borderColor: "#991b1b", color: "#991b1b", background: "#99161608" }}
              >
                {unlinking === rep.repId ? "Unlinking…" : "Unlink"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

type Tab = "settings" | "permissions" | "reps";

const TABS: { id: Tab; label: string }[] = [
  { id: "settings", label: "Settings" },
  { id: "permissions", label: "Permissions" },
  { id: "reps", label: "Reps" },
];

export default function TalentAdminClient({
  talentId,
  initialSettings,
}: {
  talentId: string;
  initialSettings: TalentSettings;
}) {
  const [activeTab, setActiveTab] = useState<Tab>("settings");

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b px-8" style={{ borderColor: "var(--color-border)" }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="relative py-3 px-1 mr-6 text-sm font-medium transition"
            style={{ color: activeTab === tab.id ? "var(--color-ink)" : "var(--color-muted)" }}
          >
            {tab.label}
            {activeTab === tab.id && (
              <span
                className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
                style={{ background: "var(--color-accent)" }}
              />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "settings" && (
          <SettingsTab talentId={talentId} initial={initialSettings} />
        )}
        {activeTab === "permissions" && (
          <PermissionsTab talentId={talentId} />
        )}
        {activeTab === "reps" && (
          <RepsTab talentId={talentId} />
        )}
      </div>
    </div>
  );
}

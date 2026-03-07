"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// ── Licence type definitions ──────────────────────────────────────────────────

type LicenceType = "film_double" | "game_character" | "commercial" | "ai_avatar" | "training_data" | "monitoring_reference";
type Exclusivity = "non_exclusive" | "sole" | "exclusive";

interface LicenceTypeOption {
  id: LicenceType;
  label: string;
  description: string;
  feeGuidance: string;
  icon: React.ReactNode;
  aiImplied?: boolean; // if true, permitAiTraining is forced on
}

const LICENCE_TYPES: LicenceTypeOption[] = [
  {
    id: "film_double",
    label: "Film / Double",
    description: "Stunt, background, or digital double for screen productions",
    feeGuidance: "Typical: £5,000 – £50,000+",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="7" width="20" height="15" rx="2" />
        <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
        <line x1="12" y1="12" x2="12" y2="16" />
        <line x1="10" y1="14" x2="14" y2="14" />
      </svg>
    ),
  },
  {
    id: "game_character",
    label: "Game Character",
    description: "3D modelling for interactive entertainment and game development",
    feeGuidance: "Typical: £2,000 – £25,000",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="6" y1="12" x2="10" y2="12" />
        <line x1="8" y1="10" x2="8" y2="14" />
        <circle cx="15" cy="13" r="1" />
        <circle cx="18" cy="11" r="1" />
        <path d="M3 8h18a1 1 0 0 1 1 1v7a4 4 0 0 1-4 4H5a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1z" />
      </svg>
    ),
  },
  {
    id: "commercial",
    label: "Commercial / Advertising",
    description: "Brand campaigns, product placement, or promotional content",
    feeGuidance: "Typical: £3,000 – £15,000",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    ),
  },
  {
    id: "ai_avatar",
    label: "AI Avatar / Virtual Self",
    description: "Personal digital assistant, metaverse presence, or interactive replica",
    feeGuidance: "Typical: £10,000 – £100,000",
    aiImplied: true,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M2 20a10 10 0 0 1 20 0" />
        <path d="M9 8h6" />
        <path d="M9 11h6" />
      </svg>
    ),
  },
  {
    id: "training_data",
    label: "AI Training Data",
    description: "Dataset inclusion for machine learning model training",
    feeGuidance: "Typical: £20,000 – £200,000+",
    aiImplied: true,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M3 5v14a9 3 0 0 0 18 0V5" />
        <path d="M3 12a9 3 0 0 0 18 0" />
      </svg>
    ),
  },
  {
    id: "monitoring_reference",
    label: "Identity / Security Reference",
    description: "Biometric identity verification or security monitoring systems",
    feeGuidance: "Typical: £1,000 – £10,000",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
  },
];

const EXCLUSIVITY_OPTIONS: { id: Exclusivity; label: string; description: string }[] = [
  { id: "non_exclusive", label: "Non-exclusive", description: "Talent may grant the same rights to other parties simultaneously" },
  { id: "sole", label: "Sole", description: "Talent won't grant the same rights to others, but retains their own use" },
  { id: "exclusive", label: "Exclusive", description: "Sole use — talent cannot grant these rights to any other party" },
];

const TERRITORY_OPTIONS = [
  "Worldwide",
  "United Kingdom",
  "United States",
  "European Union",
  "North America",
  "Asia Pacific",
  "Other",
];

// ── Step indicator ────────────────────────────────────────────────────────────

const STEPS = ["Usage Type", "Project Details", "Commercial Terms", "AI & Data Terms", "Declaration"];

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="mb-8 flex items-center gap-0">
      {STEPS.map((label, i) => (
        <div key={i} className="flex items-center">
          <div className="flex flex-col items-center">
            <div
              className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors"
              style={{
                background: i < current ? "var(--color-accent)" : i === current ? "var(--color-accent)" : "var(--color-border)",
                color: i <= current ? "#fff" : "var(--color-muted)",
                opacity: i < current ? 0.6 : 1,
              }}
            >
              {i < current ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                i + 1
              )}
            </div>
            <span
              className="mt-1 hidden text-[10px] font-medium sm:block"
              style={{ color: i === current ? "var(--color-ink)" : "var(--color-muted)" }}
            >
              {label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div
              className="mx-1 h-px w-6 flex-shrink-0 sm:w-10"
              style={{ background: i < current ? "var(--color-accent)" : "var(--color-border)", opacity: i < current ? 0.5 : 1 }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function LicenceRequestClient({ packageId }: { packageId: string }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [licenceType, setLicenceType] = useState<LicenceType | null>(null);
  const [projectName, setProjectName] = useState("");
  const [productionCompany, setProductionCompany] = useState("");
  const [intendedUse, setIntendedUse] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const [territory, setTerritory] = useState("Worldwide");
  const [exclusivity, setExclusivity] = useState<Exclusivity>("non_exclusive");
  const [proposedFee, setProposedFee] = useState("");
  const [permitAiTraining, setPermitAiTraining] = useState(false);
  const [declared, setDeclared] = useState(false);

  const selectedType = LICENCE_TYPES.find((t) => t.id === licenceType);
  const aiImplied = selectedType?.aiImplied ?? false;
  const effectiveAi = aiImplied || permitAiTraining;

  const labelClass = "block text-xs font-medium mb-1.5";
  const inputClass = "w-full rounded border px-3 py-2 text-sm outline-none focus:ring-1 transition";
  const inputStyle = { borderColor: "var(--color-border)", background: "var(--color-bg)", color: "var(--color-text)" };

  // ── Step validation ─────────────────────────────────────────────────────────

  function canAdvance(): boolean {
    if (step === 0) return licenceType !== null;
    if (step === 1) {
      if (!projectName.trim() || !productionCompany.trim() || !intendedUse.trim() || !validFrom || !validTo) return false;
      return new Date(validTo) > new Date(validFrom);
    }
    if (step === 2) return !!territory;
    if (step === 3) return true; // AI terms are always optional
    return false;
  }

  function next() {
    setError(null);
    if (!canAdvance()) {
      if (step === 1 && validTo && validFrom && new Date(validTo) <= new Date(validFrom)) {
        setError("End date must be after start date.");
      } else {
        setError("Please complete all required fields.");
      }
      return;
    }
    // Auto-enable AI flag when type implies it
    if (step === 0 && LICENCE_TYPES.find((t) => t.id === licenceType)?.aiImplied) {
      setPermitAiTraining(true);
    }
    setStep((s) => s + 1);
  }

  function back() {
    setError(null);
    setStep((s) => s - 1);
  }

  // ── Submit ──────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (!declared) { setError("Please confirm the declaration to proceed."); return; }
    setError(null);
    setSubmitting(true);

    const vf = Math.floor(new Date(validFrom).getTime() / 1000);
    const vt = Math.floor(new Date(validTo).getTime() / 1000);
    const proposedFeePence = proposedFee ? Math.round(parseFloat(proposedFee) * 100) : undefined;

    try {
      const res = await fetch("/api/licences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageId,
          projectName: projectName.trim(),
          productionCompany: productionCompany.trim(),
          intendedUse: intendedUse.trim(),
          validFrom: vf,
          validTo: vt,
          fileScope: "all",
          licenceType,
          territory,
          exclusivity,
          permitAiTraining: effectiveAi,
          proposedFee: proposedFeePence,
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      router.push("/licences");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Step renders ────────────────────────────────────────────────────────────

  function renderStep0() {
    return (
      <>
        <h2 className="text-base font-semibold mb-1" style={{ color: "var(--color-ink)" }}>How will the likeness be used?</h2>
        <p className="text-sm mb-6" style={{ color: "var(--color-muted)" }}>
          Select the primary use case. This determines applicable terms and fee guidance.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {LICENCE_TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setLicenceType(t.id)}
              className="rounded border p-4 text-left transition hover:shadow-sm focus:outline-none"
              style={{
                borderColor: licenceType === t.id ? "var(--color-accent)" : "var(--color-border)",
                background: licenceType === t.id ? "var(--color-surface)" : "var(--color-bg)",
                boxShadow: licenceType === t.id ? "0 0 0 2px var(--color-accent)" : undefined,
              }}
            >
              <div className="mb-2 flex items-center gap-2.5" style={{ color: licenceType === t.id ? "var(--color-accent)" : "var(--color-muted)" }}>
                {t.icon}
                <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>{t.label}</span>
                {t.aiImplied && (
                  <span
                    className="ml-auto rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
                    style={{ background: "rgba(220,100,0,0.12)", color: "#b45309" }}
                  >
                    AI
                  </span>
                )}
              </div>
              <p className="text-xs leading-snug mb-1.5" style={{ color: "var(--color-muted)" }}>{t.description}</p>
              <p className="text-[11px] font-medium" style={{ color: licenceType === t.id ? "var(--color-accent)" : "var(--color-muted)" }}>
                {t.feeGuidance}
              </p>
            </button>
          ))}
        </div>
      </>
    );
  }

  function renderStep1() {
    return (
      <>
        <h2 className="text-base font-semibold mb-1" style={{ color: "var(--color-ink)" }}>Project Details</h2>
        <p className="text-sm mb-6" style={{ color: "var(--color-muted)" }}>
          Tell us about the production and the period of use.
        </p>
        <div className="space-y-4">
          <div>
            <label className={labelClass} style={{ color: "var(--color-text)" }}>Project name *</label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="e.g. The Odyssey (2025)"
              className={inputClass}
              style={inputStyle}
            />
          </div>
          <div>
            <label className={labelClass} style={{ color: "var(--color-text)" }}>Production company *</label>
            <input
              type="text"
              value={productionCompany}
              onChange={(e) => setProductionCompany(e.target.value)}
              placeholder="e.g. Universal Pictures"
              className={inputClass}
              style={inputStyle}
            />
          </div>
          <div>
            <label className={labelClass} style={{ color: "var(--color-text)" }}>Intended use — describe specifically *</label>
            <textarea
              value={intendedUse}
              onChange={(e) => setIntendedUse(e.target.value)}
              placeholder={
                licenceType === "film_double"
                  ? "Describe the scenes or sequences in which the digital double will appear…"
                  : licenceType === "training_data"
                  ? "Describe which models will be trained, their purpose, and how the biometric data will be processed…"
                  : "Describe how the likeness scan will be used in the production…"
              }
              rows={4}
              className={inputClass}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass} style={{ color: "var(--color-text)" }}>Licence start *</label>
              <input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} className={inputClass} style={inputStyle} />
            </div>
            <div>
              <label className={labelClass} style={{ color: "var(--color-text)" }}>Licence end *</label>
              <input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} className={inputClass} style={inputStyle} />
            </div>
          </div>
        </div>
      </>
    );
  }

  function renderStep2() {
    const feeGuidance = selectedType?.feeGuidance ?? "";
    return (
      <>
        <h2 className="text-base font-semibold mb-1" style={{ color: "var(--color-ink)" }}>Commercial Terms</h2>
        <p className="text-sm mb-6" style={{ color: "var(--color-muted)" }}>
          Specify territory, exclusivity, and your proposed licence fee. The talent may counter-offer.
        </p>
        <div className="space-y-5">
          <div>
            <label className={labelClass} style={{ color: "var(--color-text)" }}>Territory</label>
            <select
              value={territory}
              onChange={(e) => setTerritory(e.target.value)}
              className={inputClass}
              style={{ ...inputStyle, appearance: "auto" }}
            >
              {TERRITORY_OPTIONS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass} style={{ color: "var(--color-text)" }}>Exclusivity</label>
            <div className="space-y-2">
              {EXCLUSIVITY_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setExclusivity(opt.id)}
                  className="w-full rounded border p-3 text-left transition hover:shadow-sm"
                  style={{
                    borderColor: exclusivity === opt.id ? "var(--color-accent)" : "var(--color-border)",
                    background: exclusivity === opt.id ? "var(--color-surface)" : "var(--color-bg)",
                    boxShadow: exclusivity === opt.id ? "0 0 0 2px var(--color-accent)" : undefined,
                  }}
                >
                  <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>{opt.label}</span>
                  <span className="ml-2 text-xs" style={{ color: "var(--color-muted)" }}>— {opt.description}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={labelClass} style={{ color: "var(--color-text)" }}>
              Proposed licence fee (optional)
            </label>
            <div className="relative">
              <span
                className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm"
                style={{ color: "var(--color-muted)" }}
              >
                £
              </span>
              <input
                type="number"
                min="0"
                step="100"
                value={proposedFee}
                onChange={(e) => setProposedFee(e.target.value)}
                placeholder="0"
                className={inputClass}
                style={{ ...inputStyle, paddingLeft: "1.75rem" }}
              />
            </div>
            {feeGuidance && (
              <p className="mt-1 text-xs" style={{ color: "var(--color-muted)" }}>
                {feeGuidance} · Platform fee: 15% of agreed amount
              </p>
            )}
            {proposedFee && parseFloat(proposedFee) > 0 && (
              <div
                className="mt-2 rounded px-3 py-2 text-xs"
                style={{ background: "var(--color-surface)", borderColor: "var(--color-border)", border: "1px solid" }}
              >
                <div className="flex justify-between">
                  <span style={{ color: "var(--color-muted)" }}>Proposed fee</span>
                  <span style={{ color: "var(--color-ink)" }}>£{parseFloat(proposedFee).toLocaleString("en-GB", { minimumFractionDigits: 0 })}</span>
                </div>
                <div className="mt-1 flex justify-between">
                  <span style={{ color: "var(--color-muted)" }}>Platform fee (15%)</span>
                  <span style={{ color: "var(--color-muted)" }}>£{(parseFloat(proposedFee) * 0.15).toLocaleString("en-GB", { minimumFractionDigits: 0 })}</span>
                </div>
                <div className="mt-1 flex justify-between font-medium">
                  <span style={{ color: "var(--color-muted)" }}>Talent receives (est.)</span>
                  <span style={{ color: "var(--color-accent)" }}>£{(parseFloat(proposedFee) * 0.85).toLocaleString("en-GB", { minimumFractionDigits: 0 })}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  function renderStep3() {
    return (
      <>
        <h2 className="text-base font-semibold mb-1" style={{ color: "var(--color-ink)" }}>AI & Data Terms</h2>
        <p className="text-sm mb-6" style={{ color: "var(--color-muted)" }}>
          Confirm how biometric data may be used in relation to artificial intelligence.
        </p>

        {aiImplied && (
          <div
            className="mb-5 rounded border p-4"
            style={{ borderColor: "#b45309", background: "rgba(180,83,9,0.07)" }}
          >
            <div className="flex gap-2.5">
              <svg className="mt-0.5 flex-shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#b45309" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <div>
                <p className="text-xs font-semibold" style={{ color: "#b45309" }}>AI use is inherent to this licence type</p>
                <p className="mt-0.5 text-xs" style={{ color: "#92400e" }}>
                  &ldquo;{selectedType?.label}&rdquo; licences require biometric data processing by AI systems. The talent will be explicitly informed of this when reviewing your request.
                </p>
              </div>
            </div>
          </div>
        )}

        <div
          className="rounded border p-4"
          style={{
            borderColor: effectiveAi ? "#b45309" : "var(--color-border)",
            background: effectiveAi ? "rgba(180,83,9,0.04)" : "var(--color-surface)",
          }}
        >
          <label className="flex cursor-pointer items-start gap-3">
            <div className="relative mt-0.5">
              <input
                type="checkbox"
                checked={effectiveAi}
                onChange={(e) => !aiImplied && setPermitAiTraining(e.target.checked)}
                disabled={aiImplied}
                className="h-4 w-4 cursor-pointer rounded"
                style={{ accentColor: "var(--color-accent)" }}
              />
            </div>
            <div>
              <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                Permission to process biometric data using AI systems
              </span>
              <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--color-muted)" }}>
                This includes: training machine learning models, generating synthetic media, creating AI avatars, or any automated processing that extracts feature vectors from the biometric scan data.
              </p>
            </div>
          </label>
        </div>

        {effectiveAi && (
          <div
            className="mt-4 rounded border p-4 text-xs leading-relaxed"
            style={{ borderColor: "#dc2626", background: "rgba(220,38,38,0.05)", color: "#991b1b" }}
          >
            <p className="font-semibold mb-1">Important — AI Processing Notice</p>
            <p>
              By enabling AI processing, you acknowledge that the biometric scan data may be used to train, fine-tune, or evaluate machine learning models. The talent retains the right to revoke this permission at any time. This request will be flagged for the talent&apos;s specific attention and may require additional contractual terms.
            </p>
          </div>
        )}

        {!effectiveAi && !aiImplied && (
          <div
            className="mt-4 rounded border p-4 text-xs leading-relaxed"
            style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}
          >
            AI processing is <strong>not requested</strong>. The scan data may only be used for the stated purpose and must not be used to train any machine learning models.
          </div>
        )}
      </>
    );
  }

  function renderStep4() {
    const feePence = proposedFee ? Math.round(parseFloat(proposedFee) * 100) : 0;
    const feeDisplay = feePence > 0 ? `£${(feePence / 100).toLocaleString("en-GB")}` : "Not specified";
    const typeLabel = LICENCE_TYPES.find((t) => t.id === licenceType)?.label ?? licenceType;
    const exclusivityLabel = EXCLUSIVITY_OPTIONS.find((e) => e.id === exclusivity)?.label ?? exclusivity;

    return (
      <>
        <h2 className="text-base font-semibold mb-1" style={{ color: "var(--color-ink)" }}>Review & Declaration</h2>
        <p className="text-sm mb-5" style={{ color: "var(--color-muted)" }}>
          Please review your request before submitting.
        </p>

        <div
          className="mb-5 divide-y rounded border text-sm"
          style={{ borderColor: "var(--color-border)" }}
        >
          {[
            ["Usage type", typeLabel],
            ["Project", projectName],
            ["Production company", productionCompany],
            ["Territory", territory],
            ["Exclusivity", exclusivityLabel],
            ["Licence period", `${validFrom} → ${validTo}`],
            ["Proposed fee", feeDisplay],
            ["AI processing", effectiveAi ? "Requested" : "Not requested"],
          ].map(([key, value]) => (
            <div key={key} className="flex justify-between gap-4 px-4 py-2.5">
              <span className="text-xs" style={{ color: "var(--color-muted)" }}>{key}</span>
              <span
                className="text-xs font-medium text-right"
                style={{
                  color:
                    key === "AI processing" && effectiveAi ? "#b45309"
                    : "var(--color-ink)",
                }}
              >
                {value}
              </span>
            </div>
          ))}
        </div>

        <div
          className="mb-5 rounded border p-4 text-xs leading-relaxed"
          style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}
        >
          By submitting this request I confirm that the stated use is accurate, that my organisation will handle all biometric scan data in compliance with applicable data protection legislation (including but not limited to UK GDPR and the Data Protection Act 2018), and that access is subject to talent approval and a mandatory dual-custody verification step before any files can be downloaded.{" "}
          {effectiveAi && "I further acknowledge that AI processing of biometric data carries additional legal obligations and that specific consent must be obtained from the data subject. "}
          All terms are subject to the platform&apos;s standard licence agreement.
        </div>

        <label className="flex cursor-pointer items-start gap-3 mb-5">
          <input
            type="checkbox"
            checked={declared}
            onChange={(e) => { setDeclared(e.target.checked); setError(null); }}
            className="mt-0.5 h-4 w-4 cursor-pointer rounded"
            style={{ accentColor: "var(--color-accent)" }}
          />
          <span className="text-xs" style={{ color: "var(--color-text)" }}>
            I have read and agree to the declaration above and confirm I am authorised to submit this request on behalf of {productionCompany || "my organisation"}.
          </span>
        </label>
      </>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-8 max-w-2xl">
      <Link href="/directory" className="mb-6 inline-flex items-center gap-1.5 text-xs" style={{ color: "var(--color-muted)" }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Back to directory
      </Link>

      <h1 className="text-xl font-semibold mb-1" style={{ color: "var(--color-ink)" }}>Request Licence</h1>
      <p className="text-sm mb-8" style={{ color: "var(--color-muted)" }}>
        The talent will review your request and approve, deny, or counter-offer within their own timeline.
      </p>

      <StepIndicator current={step} />

      <div className="min-h-[320px]">
        {step === 0 && renderStep0()}
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}
        {step === 4 && renderStep4()}
      </div>

      {error && (
        <p className="mt-4 text-xs" style={{ color: "var(--color-danger)" }}>{error}</p>
      )}

      <div className="mt-6 flex items-center gap-3">
        {step > 0 && (
          <button
            type="button"
            onClick={back}
            className="rounded border px-4 py-2.5 text-sm font-medium transition"
            style={{ borderColor: "var(--color-border)", color: "var(--color-text)", background: "var(--color-bg)" }}
          >
            Back
          </button>
        )}

        {step < STEPS.length - 1 ? (
          <button
            type="button"
            onClick={next}
            className="rounded px-6 py-2.5 text-sm font-medium text-white transition"
            style={{ background: "var(--color-accent)" }}
          >
            Continue
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !declared}
            className="rounded px-6 py-2.5 text-sm font-medium text-white transition disabled:opacity-60"
            style={{ background: "var(--color-accent)" }}
          >
            {submitting ? "Submitting…" : "Submit Licence Request"}
          </button>
        )}
      </div>
    </div>
  );
}

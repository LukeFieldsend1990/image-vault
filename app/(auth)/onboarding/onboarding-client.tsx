"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { TmdbCandidate } from "@/app/api/onboarding/search/route";

type Step = "search" | "confirm" | "claim" | "union" | "done";

interface ClaimableRole {
  castId: string;
  productionId: string;
  productionName: string;
  companyName: string;
  characterName: string | null;
  matchType: "tmdb" | "name";
}

// ── Placeholder avatar ─────────────────────────────────────────────────────────
function AvatarPlaceholder({ name, size }: { name: string; size: number }) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <div
      className="flex items-center justify-center font-semibold text-white shrink-0"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        background: "#1a1a1a",
        fontSize: size / 3,
      }}
    >
      {initials || "?"}
    </div>
  );
}

// ── Result card ────────────────────────────────────────────────────────────────
function CandidateCard({
  candidate,
  onSelect,
}: {
  candidate: TmdbCandidate;
  onSelect: (c: TmdbCandidate) => void;
}) {
  return (
    <div
      className="flex items-center gap-4 rounded-sm border p-4 transition hover:border-[--color-ink] cursor-pointer"
      style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
      onClick={() => onSelect(candidate)}
    >
      {candidate.profileImageUrl ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={candidate.profileImageUrl}
          alt={candidate.name}
          width={52}
          height={78}
          className="shrink-0 rounded-sm object-cover"
          style={{ width: 52, height: 78 }}
        />
      ) : (
        <AvatarPlaceholder name={candidate.name} size={52} />
      )}

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[--color-ink] mb-0.5">{candidate.name}</p>
        {candidate.knownFor.length > 0 ? (
          <p className="text-xs leading-relaxed" style={{ color: "var(--color-muted)" }}>
            {candidate.knownFor.map((k) => k.title).join(" · ")}
          </p>
        ) : (
          <p className="text-xs italic" style={{ color: "var(--color-muted)" }}>
            No credits listed
          </p>
        )}
      </div>

      <button
        className="shrink-0 rounded-sm px-3 py-1.5 text-xs font-medium text-white transition"
        style={{ background: "var(--color-ink)", borderRadius: "var(--radius)" }}
        onClick={(e) => { e.stopPropagation(); onSelect(candidate); }}
      >
        This is me
      </button>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function OnboardingClient({ isUpdate = false }: { isUpdate?: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("search");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<TmdbCandidate[]>([]);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<TmdbCandidate | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [claimable, setClaimable] = useState<ClaimableRole[]>([]);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimedIds, setClaimedIds] = useState<Set<string>>(new Set());
  const [unionAffiliation, setUnionAffiliation] = useState("");
  const [savingUnion, setSavingUnion] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim() || searching) return;
    setSearching(true);
    setSearchError(null);
    setSearched(false);
    setResults([]);

    try {
      const res = await fetch(
        `/api/onboarding/search?q=${encodeURIComponent(query.trim())}`,
      );
      const data = await res.json() as { candidates?: TmdbCandidate[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Search failed");
      setResults(data.candidates ?? []);
      setSearched(true);
    } catch (err: unknown) {
      setSearchError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }

  function handleSelect(candidate: TmdbCandidate) {
    setSelected(candidate);
    setStep("confirm");
  }

  async function handleConfirm() {
    setConfirming(true);
    try {
      const body = selected
        ? {
            fullName: selected.name,
            tmdbId: selected.id,
            profileImageUrl: selected.profileImageUrl ?? undefined,
            knownFor: selected.knownFor,
            popularity: selected.popularity,
          }
        : { skip: true };

      const res = await fetch("/api/onboarding/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Confirm failed");
      // Path D: if a production already reserved a role for this profile, offer
      // to claim it inline before entering the vault.
      const data = await res.json().catch(() => ({})) as { claimable?: ClaimableRole[] };
      if (!isUpdate && data.claimable && data.claimable.length > 0) {
        setClaimable(data.claimable);
        setStep("claim");
        setConfirming(false);
        return;
      }
      if (isUpdate) {
        router.push("/settings");
      } else {
        setStep("union");
      }
    } catch {
      setConfirming(false);
    }
  }

  async function claimReservedRole(role: ClaimableRole) {
    setClaimingId(role.castId);
    try {
      const r = await fetch(`/api/productions/${role.productionId}/cast/${role.castId}/claim`, { method: "POST" });
      if (r.ok) setClaimedIds((prev) => new Set(prev).add(role.castId));
    } finally {
      setClaimingId(null);
    }
  }

  async function handleSkip() {
    await fetch("/api/onboarding/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skip: true }),
    });
    if (isUpdate) {
      router.push("/settings");
    } else {
      setStep("union");
    }
  }

  async function saveUnionAffiliation() {
    setSavingUnion(true);
    try {
      await fetch("/api/onboarding/union-affiliation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unionAffiliation: unionAffiliation.trim() || null }),
      });
    } finally {
      setSavingUnion(false);
      router.push("/dashboard");
    }
  }

  // ── Layout ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen">
      {/* ── Left panel ── */}
      <div className="flex flex-1 flex-col justify-between px-12 py-12 lg:px-16">
        {/* Wordmark */}
        <div>
          <span className="text-xs font-semibold tracking-[0.2em] uppercase text-[--color-ink]">
            Image Vault
          </span>
        </div>

        {/* ── Step: Search ── */}
        {step === "search" && (
          <div className="w-full max-w-sm">
            <h1 className="mb-1 text-3xl font-semibold tracking-tight text-[--color-ink]">
              {isUpdate ? "Update your identity" : "Who are you?"}
            </h1>
            <p className="mb-8 text-sm" style={{ color: "var(--color-muted)" }}>
              {isUpdate
                ? "Search for your name to link your vault to your verified industry profile."
                : "Search for your name and we\u2019ll pull your profile from our industry database. This links your vault to your verified identity."}
            </p>

            <form onSubmit={handleSearch} className="flex gap-2 mb-6">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Your full name…"
                className="flex-1 border border-[--color-border] bg-white px-4 py-3 text-sm text-[--color-ink] placeholder-[--color-border] outline-none transition focus:border-[--color-ink]"
                style={{ borderRadius: "var(--radius)" }}
              />
              <button
                type="submit"
                disabled={!query.trim() || searching}
                className="px-5 py-3 text-sm font-medium text-white transition disabled:opacity-50"
                style={{ background: "var(--color-ink)", borderRadius: "var(--radius)" }}
              >
                {searching ? (
                  <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                  </svg>
                ) : (
                  "Search"
                )}
              </button>
            </form>

            {searchError && (
              <p className="mb-4 text-xs" style={{ color: "var(--color-danger)" }}>{searchError}</p>
            )}

            {searched && results.length === 0 && (
              <p className="mb-4 text-sm" style={{ color: "var(--color-muted)" }}>
                No results found. Try a different spelling, or skip for now.
              </p>
            )}

            {results.length > 0 && (
              <div className="space-y-2 mb-6 max-h-96 overflow-y-auto pr-1">
                {results.map((c) => (
                  <CandidateCard key={c.id} candidate={c} onSelect={handleSelect} />
                ))}
              </div>
            )}

            <button
              onClick={handleSkip}
              className="text-xs underline underline-offset-2 transition"
              style={{ color: "var(--color-muted)" }}
            >
              Skip for now — I&apos;ll set this up later
            </button>
          </div>
        )}

        {/* ── Step: Confirm ── */}
        {step === "confirm" && selected && (
          <div className="w-full max-w-sm">
            <button
              onClick={() => setStep("search")}
              className="mb-8 inline-flex items-center gap-1.5 text-xs transition"
              style={{ color: "var(--color-muted)" }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              Back to search
            </button>

            <h1 className="mb-1 text-3xl font-semibold tracking-tight text-[--color-ink]">
              Is this you?
            </h1>
            <p className="mb-8 text-sm" style={{ color: "var(--color-muted)" }}>
              Confirm your identity to link your vault to your industry profile.
            </p>

            {/* Profile card */}
            <div
              className="flex items-start gap-5 rounded-sm border p-5 mb-6"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              {selected.profileImageUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={selected.profileImageUrl}
                  alt={selected.name}
                  width={72}
                  height={108}
                  className="shrink-0 rounded-sm object-cover shadow-sm"
                  style={{ width: 72, height: 108 }}
                />
              ) : (
                <AvatarPlaceholder name={selected.name} size={72} />
              )}

              <div className="flex-1 min-w-0 pt-1">
                <p className="text-lg font-semibold tracking-tight text-[--color-ink] mb-1">
                  {selected.name}
                </p>

                {selected.knownFor.length > 0 && (
                  <div className="space-y-0.5">
                    <p className="text-[10px] uppercase tracking-wide font-medium mb-1.5" style={{ color: "var(--color-muted)" }}>
                      Known for
                    </p>
                    {selected.knownFor.map((k, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs" style={{ color: "var(--color-text)" }}>
                        <span
                          className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-sm font-medium"
                          style={{ background: "var(--color-border)", color: "var(--color-muted)" }}
                        >
                          {k.type === "movie" ? "Film" : "TV"}
                        </span>
                        <span>{k.title}</span>
                        {k.year && <span style={{ color: "var(--color-muted)" }}>{k.year}</span>}
                      </div>
                    ))}
                  </div>
                )}

                {selected.popularity > 0 && (
                  <p className="mt-3 text-[10px]" style={{ color: "var(--color-muted)" }}>
                    Industry profile score: {selected.popularity}
                  </p>
                )}
              </div>
            </div>

            <p className="mb-5 text-xs leading-relaxed" style={{ color: "var(--color-muted)" }}>
              By confirming, you link your Image Vault account to this industry profile. This
              helps licensees identify you in the talent directory.
            </p>

            <button
              onClick={handleConfirm}
              disabled={confirming}
              className="btn-accent w-full px-4 py-3.5 text-sm font-medium tracking-wide text-white transition disabled:opacity-50 mb-3"
            >
              {confirming ? "Saving…" : "Yes, that's me — enter my vault"}
            </button>

            <button
              onClick={() => setStep("search")}
              className="w-full text-xs underline underline-offset-2 transition"
              style={{ color: "var(--color-muted)" }}
            >
              That&apos;s not me — search again
            </button>
          </div>
        )}

        {/* ── Step: Claim reserved roles (Path D) ── */}
        {step === "claim" && (
          <div className="w-full max-w-sm">
            <h1 className="mb-1 text-3xl font-semibold tracking-tight text-[--color-ink]">
              {claimable.length === 1 ? "A production reserved a role for you" : "Productions reserved roles for you"}
            </h1>
            <p className="mb-8 text-sm" style={{ color: "var(--color-muted)" }}>
              We found {claimable.length === 1 ? "a role" : "roles"} waiting for you. Claim {claimable.length === 1 ? "it" : "them"} to let the production know you&apos;re here.
            </p>

            <div className="space-y-2 mb-8">
              {claimable.map((role) => {
                const isClaimed = claimedIds.has(role.castId);
                return (
                  <div
                    key={role.castId}
                    className="flex items-center gap-3 rounded-sm border p-4"
                    style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[--color-ink]">
                        {role.characterName ?? "A role"} in {role.productionName}
                      </p>
                      <p className="text-xs" style={{ color: "var(--color-muted)" }}>Reserved by {role.companyName}</p>
                    </div>
                    {isClaimed ? (
                      <span className="text-xs font-medium shrink-0" style={{ color: "#166534" }}>Claimed ✓</span>
                    ) : (
                      <button
                        onClick={() => claimReservedRole(role)}
                        disabled={claimingId === role.castId}
                        className="shrink-0 rounded-sm px-3 py-1.5 text-xs font-medium text-white transition disabled:opacity-50"
                        style={{ background: "var(--color-ink)", borderRadius: "var(--radius)" }}
                      >
                        {claimingId === role.castId ? "Claiming…" : "This is me"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <button
              onClick={() => setStep("union")}
              className="btn-accent w-full px-4 py-3.5 text-sm font-medium tracking-wide text-white transition"
            >
              Continue
            </button>
          </div>
        )}

        {/* ── Step: Union affiliation ── */}
        {step === "union" && (
          <div className="w-full max-w-sm">
            <h1 className="mb-1 text-3xl font-semibold tracking-tight text-[--color-ink]">
              Union membership
            </h1>
            <p className="mb-8 text-sm" style={{ color: "var(--color-muted)" }}>
              Are you a member of a performers&apos; union? This helps unions track your activity on the platform.
            </p>

            {/* Quick-select buttons */}
            <div className="flex gap-2 mb-4">
              {["SAG-AFTRA", "Equity"].map((u) => (
                <button
                  key={u}
                  onClick={() => setUnionAffiliation((prev) => prev === u ? "" : u)}
                  className="px-4 py-2 rounded text-sm font-medium border transition"
                  style={{
                    borderColor: unionAffiliation === u ? "var(--color-ink)" : "var(--color-border)",
                    background: unionAffiliation === u ? "var(--color-ink)" : "transparent",
                    color: unionAffiliation === u ? "white" : "var(--color-muted)",
                  }}
                >
                  {u}
                </button>
              ))}
            </div>

            {/* Free-text input */}
            <input
              type="text"
              value={unionAffiliation}
              onChange={(e) => setUnionAffiliation(e.target.value)}
              placeholder="Other union or free text…"
              className="w-full border border-[--color-border] bg-white px-4 py-3 text-sm text-[--color-ink] placeholder-[--color-border] outline-none transition focus:border-[--color-ink] mb-6"
              style={{ borderRadius: "var(--radius)" }}
            />

            <button
              onClick={() => void saveUnionAffiliation()}
              disabled={savingUnion}
              className="btn-accent w-full px-4 py-3.5 text-sm font-medium tracking-wide text-white transition disabled:opacity-50 mb-3"
            >
              {savingUnion ? "Saving…" : unionAffiliation.trim() ? "Save and enter vault" : "Enter vault"}
            </button>

            <button
              onClick={() => void saveUnionAffiliation()}
              disabled={savingUnion}
              className="w-full text-xs underline underline-offset-2 transition"
              style={{ color: "var(--color-muted)" }}
            >
              Skip — I&apos;ll set this later
            </button>
          </div>
        )}

        {/* Footer */}
        <p className="text-xs text-[--color-muted]">
          &copy; {new Date().getFullYear()} Image Vault. All rights reserved.
        </p>
      </div>

      {/* ── Right panel (dark) ── */}
      <div
        className="hidden lg:flex lg:w-[45%] flex-col justify-between p-16"
        style={{ background: "var(--color-sidebar)" }}
      >
        <div />
        <div>
          <p
            className="text-4xl font-light leading-tight tracking-tight mb-6"
            style={{ color: "var(--color-sidebar-fg)" }}
          >
            Your talent.
            <br />
            Your terms.
            <br />
            Your vault.
          </p>
          <p
            className="text-sm leading-relaxed"
            style={{ color: "var(--color-sidebar-muted)" }}
          >
            The only platform where you control who accesses your digital likeness — with a
            dual-custody verified chain of custody on every download.
          </p>
          <div className="mt-10 space-y-4">
            {[
              "Dual-custody 2FA on every download",
              "Complete chain of custody record",
              "Revoke access at any time",
              "Encrypted at rest, with full audit logging",
            ].map((f) => (
              <div key={f} className="flex items-start gap-3">
                <div
                  className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: "var(--color-accent)" }}
                />
                <p className="text-sm" style={{ color: "var(--color-sidebar-muted)" }}>
                  {f}
                </p>
              </div>
            ))}
          </div>
        </div>
        <div className="text-xs" style={{ color: "var(--color-sidebar-muted)" }}>
          Industry identity verification powered by our verified talent database.
        </div>
      </div>
    </div>
  );
}

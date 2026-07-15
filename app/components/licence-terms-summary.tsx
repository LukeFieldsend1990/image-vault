// Shared, presentational summary of a licence / term set. Rendered identically
// wherever a term set is shown (producer, talent, rep) so the views can't drift.
// Pure presentational — no hooks, no "use client" directive, so it can live in
// either a server or client tree.

export interface LicenceTermsView {
  intendedUse?: string | null;
  licenceType?: string | null; // legacy single
  licenceTypes?: string[] | null; // multi-select use types (enum values)
  validFrom?: number | null; // unix seconds
  validTo?: number | null; // unix seconds
  durationOfProduction?: boolean | null; // if true show "Duration of production" instead of a date window
  territory?: string | null;
  exclusivity?: string | null; // non_exclusive | sole | exclusive
  proposedFee?: number | null; // pence; null = N/A
  isRelicense?: boolean | null;
  permitAiTraining?: boolean | null;
}

const USE_TYPE_LABELS: Record<string, string> = {
  film_double: "Film / Double",
  game_character: "Game Character",
  commercial: "Commercial",
  ai_avatar: "AI Avatar",
  training_data: "Training Data",
  monitoring_reference: "Identity Reference",
};

const EXCLUSIVITY_LABELS: Record<string, string> = {
  non_exclusive: "Non-exclusive",
  sole: "Sole",
  exclusive: "Exclusive",
};

export function humaniseUseType(value: string): string {
  return USE_TYPE_LABELS[value] ?? value.replace(/_/g, " ");
}

export function exclusivityLabel(value: string): string {
  return EXCLUSIVITY_LABELS[value] ?? value;
}

function fmtDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const Label = ({ children }: { children: React.ReactNode }) => (
  <p
    className="text-xs font-medium tracking-widest uppercase"
    style={{ color: "var(--color-muted)" }}
  >
    {children}
  </p>
);

export default function LicenceTermsSummary({ terms }: { terms?: LicenceTermsView | null }) {
  if (!terms) return null;

  const intendedUse = terms.intendedUse?.trim();

  const rawTypes =
    terms.licenceTypes && terms.licenceTypes.length
      ? terms.licenceTypes
      : terms.licenceType
        ? [terms.licenceType]
        : [];
  const types = rawTypes.filter((t): t is string => Boolean(t));

  const hasWindow =
    typeof terms.validFrom === "number" && typeof terms.validTo === "number";
  const term = terms.durationOfProduction
    ? "Duration of production"
    : hasWindow
      ? `${fmtDate(terms.validFrom as number)} – ${fmtDate(terms.validTo as number)}`
      : null;

  const territory = terms.territory?.trim();
  const exclusivity = terms.exclusivity
    ? (EXCLUSIVITY_LABELS[terms.exclusivity] ?? terms.exclusivity)
    : null;

  const feeText =
    terms.proposedFee == null
      ? null
      : `$${(terms.proposedFee / 100).toLocaleString()}`;

  return (
    <div
      className="rounded p-4 space-y-3"
      style={{
        border: "1px solid var(--color-border)",
        background: "var(--color-surface)",
      }}
    >
      {intendedUse && (
        <div className="space-y-1">
          <Label>Intended use</Label>
          <p className="text-sm" style={{ color: "var(--color-text)" }}>{intendedUse}</p>
        </div>
      )}

      {types.length > 0 && (
        <div className="space-y-1">
          <Label>{types.length === 1 ? "Use type" : "Use types"}</Label>
          <div className="flex flex-wrap gap-1.5">
            {types.map((t) => (
              <span
                key={t}
                className="text-xs rounded px-2 py-0.5"
                style={{
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text)",
                }}
              >
                {humaniseUseType(t)}
              </span>
            ))}
          </div>
        </div>
      )}

      {term && (
        <div className="space-y-1">
          <Label>Term</Label>
          <p className="text-sm" style={{ color: "var(--color-text)" }}>{term}</p>
        </div>
      )}

      {territory && (
        <div className="space-y-1">
          <Label>Territory</Label>
          <p className="text-sm" style={{ color: "var(--color-text)" }}>{territory}</p>
        </div>
      )}

      {exclusivity && (
        <div className="space-y-1">
          <Label>Exclusivity</Label>
          <p className="text-sm" style={{ color: "var(--color-text)" }}>{exclusivity}</p>
        </div>
      )}

      <div className="space-y-1">
        <Label>Fee</Label>
        <div className="flex items-center gap-2">
          {terms.isRelicense && (
            <span
              className="text-xs font-medium rounded px-2 py-0.5 text-white"
              style={{ background: "var(--color-accent)" }}
            >
              Relicense
            </span>
          )}
          {feeText ? (
            <p className="text-sm" style={{ color: "var(--color-text)" }}>
              {feeText} <span style={{ color: "var(--color-muted)" }}>(proposed)</span>
            </p>
          ) : (
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>Fee: N/A</p>
          )}
        </div>
      </div>
    </div>
  );
}

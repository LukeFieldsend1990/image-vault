/**
 * The document grammar — one visual system for every artefact Image Vault
 * produces on paper.
 *
 * Three documents used to look like three unrelated products: the chain-of-
 * custody record set in Georgia with nine ad-hoc event colours, the compliance
 * certificate in system sans with the pre-refresh accent, and the licence
 * contract in its own private palette. This module is the single source they
 * now share.
 *
 * Why literals and not `var(--color-*)`: two of the three documents are
 * rendered server-side as standalone HTML strings (certificate, contract) with
 * no access to app/globals.css, and all three are printed. The values below are
 * copied from the tokens in globals.css and MUST be kept in step with them —
 * see docs/brand-refresh-spec.md. `DOC_CSS_VARS` re-exports them as a `:root`
 * block for the standalone HTML documents.
 */

export const DOC = {
  // Paper
  paper: "#ffffff",
  inset: "#f5f5f3",
  rule: "#e6e5e1",

  // Ink ramp
  ink: "#2d2b26",
  text: "#56524a",
  muted: "#807b70",
  faint: "#b0aa9c",

  // The three lifecycle tones + the accent (brick doubles as both)
  brick: "#bc3d2c",
  brickTint: "#f2e0da",
  olive: "#6e7a4f",
  oliveTint: "#e7ebdd",
  ochre: "#c0883b",
  ochreTint: "#f3e7d4",

  // Type stack
  serif: "'Newsreader', Georgia, 'Times New Roman', serif",
  sans: "'Hanken Grotesk', 'Helvetica Neue', Helvetica, Arial, sans-serif",
  mono: "'JetBrains Mono', 'SFMono-Regular', ui-monospace, Menlo, monospace",
} as const;

/**
 * The four semantic tones an event can carry. Replaces the nine arbitrary
 * hexes the custody record used to hardcode (#1d4ed8, #6d28d9, #92400e …).
 *
 *   ink    neutral / system — something happened, nobody gained or lost a right
 *   olive  a right was granted, verified, or attested
 *   ochre  a right was asked for, or an elevated-risk use is in play
 *   brick  a right was refused, revoked, withdrawn, or an action was blocked
 */
export type Tone = "ink" | "olive" | "ochre" | "brick";

export const TONE_COLOR: Record<Tone, string> = {
  ink: DOC.ink,
  olive: DOC.olive,
  ochre: DOC.ochre,
  brick: DOC.brick,
};

export const TONE_TINT: Record<Tone, string> = {
  ink: DOC.inset,
  olive: DOC.oliveTint,
  ochre: DOC.ochreTint,
  brick: DOC.brickTint,
};

/** Tone for the derived (non-ledger) custody event types. */
const CUSTODY_TONE: Record<string, Tone> = {
  package_created: "ink",
  file_added: "ink",
  licence_requested: "ochre",
  licence_approved: "olive",
  licence_denied: "brick",
  licence_revoked: "brick",
  file_downloaded: "ink",
  talent_downloaded: "ink",
};

/** Tone for the hash-chained compliance-ledger event types. */
const LEDGER_TONE: Record<string, Tone> = {
  "consent.granted": "olive",
  "consent.dub_language_granted": "olive",
  "consent.revoked": "brick",
  "consent.counter_proposed": "ochre",
  "custody.licensee_verified": "olive",
  "custody.talent_verified": "olive",
  "download.initiated": "ochre",
  "biometric.isolation_attested": "olive",
  "security.custody_attested": "olive",
  "replica.scrub_attested": "olive",
  "strike.declared": "brick",
  "strike.lifted": "olive",
  "use.blocked_by_strike": "brick",
  "use.blocked": "brick",
  "use.metered": "ink",
  "transfer.requested": "ochre",
  "transfer.approved": "olive",
  "transfer.denied": "brick",
  "business_reason.recorded": "ink",
  "training.notice_filed": "ochre",
  "licence.denied": "brick",
  "licence.revoked": "brick",
  "package.attached": "ink",
};

/**
 * Resolve the tone for an event. `ledgerType` wins when present — a
 * `compliance_event` row is only meaningful through the ledger type it carries.
 * Unknown types fall back to `ink` rather than inventing a colour.
 */
export function eventTone(custodyType: string, ledgerType?: string | null): Tone {
  if (ledgerType) return LEDGER_TONE[ledgerType] ?? "ink";
  return CUSTODY_TONE[custodyType] ?? "ink";
}

/**
 * Group a hex digest into fixed-width runs so it can be read aloud, compared by
 * eye across two documents, and wrapped without losing the reader's place.
 *
 *   quads("3b70e2a9f1c4…") → "3b70 e2a9 f1c4 …"
 */
export function quads(hex: string | null | undefined, size = 4): string {
  if (!hex) return "";
  return (hex.match(new RegExp(`.{1,${size}}`, "g")) ?? []).join(" ");
}

/**
 * A short, quad-grouped prefix of a digest — for inline references where the
 * full 64 characters would drown the line. Always shows that it is a prefix.
 */
export function shortHash(hex: string | null | undefined, chars = 8): string {
  if (!hex) return "—";
  if (hex.length <= chars) return quads(hex);
  return `${quads(hex.slice(0, chars))}…`;
}

/** Format a unix-seconds timestamp as an unambiguous UTC stamp for evidence. */
export function isoUtc(ts: number): string {
  return new Date(ts * 1000).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

/** Date-only, for the day rules that break a long record into a chronicle. */
export function docDate(ts: number): string {
  return new Date(ts * 1000)
    .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
    .toUpperCase();
}

/** Human byte size. Shared so the manifest and the event rows agree. */
export function fmtBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Document reference, e.g. `IMG-20260808-A3F1C2`. Deliberately human-quotable:
 * it is what a reader cites in correspondence. It is NOT a capability — the
 * public verification URL uses an opaque seal ref (lib/compliance/seal.ts).
 */
export function docRef(prefix: string, ts: number, id: string): string {
  const day = new Date(ts * 1000).toISOString().slice(0, 10).replace(/-/g, "");
  return `${prefix}-${day}-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

/**
 * The palette as a `:root` block, for the documents rendered as standalone HTML
 * strings outside the app (compliance certificate, licence contract).
 */
export const DOC_CSS_VARS = `:root{
  --doc-paper:${DOC.paper};--doc-inset:${DOC.inset};--doc-rule:${DOC.rule};
  --doc-ink:${DOC.ink};--doc-text:${DOC.text};--doc-muted:${DOC.muted};--doc-faint:${DOC.faint};
  --doc-brick:${DOC.brick};--doc-brick-tint:${DOC.brickTint};
  --doc-olive:${DOC.olive};--doc-olive-tint:${DOC.oliveTint};
  --doc-ochre:${DOC.ochre};--doc-ochre-tint:${DOC.ochreTint};
  --doc-serif:${DOC.serif};--doc-sans:${DOC.sans};--doc-mono:${DOC.mono};
}`;

/**
 * Shared print rules. Both React documents inline this; the standalone HTML
 * documents concatenate it into their own <style>.
 *
 * `.doc-keep` marks a block that must not be split across a page break —
 * an event row, a manifest line, a signature grid.
 */
export const DOC_PRINT_CSS = `
@media print {
  .no-print { display: none !important; }
  .doc-body { border: none !important; box-shadow: none !important; }
  body { background: #fff !important; }
  aside, nav { display: none !important; }
  main { overflow: visible !important; }
  .doc-keep { break-inside: avoid; page-break-inside: avoid; }
  .doc-break-after { break-after: page; page-break-after: always; }
  a { text-decoration: none; color: inherit; }
}
@page { size: A4; margin: 18mm 16mm 20mm; }
`;

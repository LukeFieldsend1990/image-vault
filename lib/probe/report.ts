/**
 * The Likeness Encoding Report — a sealed, standalone HTML record of one probe
 * run. Rendered as an HTML string (like the compliance certificate and licence
 * contract) so it can be served without the app's CSS, printed, and archived.
 *
 * The report is written to be *honest on its face*. It states, in the reader's
 * first screen, exactly what a positive result proves (the model encodes this
 * identity) and what it does NOT prove (that it was trained on the vault scans),
 * because the whole platform's credibility rests on not overclaiming — the same
 * discipline as the "not zero-knowledge" framing in the project guide. Controls,
 * thresholds and seeds are shown alongside the headline number so the reader can
 * see the comparison the verdict is built on, not just the conclusion.
 *
 * The tamper seal at the foot points at the public /verify/{ref} endpoint: an
 * unauthenticated third party (opposing counsel, a licensing manager) can check
 * the ledger hash without an account.
 */

import { DOC_CSS_VARS, isoUtc, quads, shortHash } from "@/lib/documents/palette";
import type { ProbeProtocol, ProbeTarget, ProbeVerdict } from "./types";

function esc(s: string | null | undefined): string {
  if (s == null) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const ENCODING_COPY: Record<ProbeVerdict["encoding"], { label: string; tone: string; blurb: string }> = {
  strong: {
    label: "Strong identity encoding",
    tone: "var(--doc-brick)",
    blurb:
      "Prompted with this identity, the model produced faces matching the talent's vault references at a rate far above the control cohort, with the difference unlikely to be chance.",
  },
  moderate: {
    label: "Moderate identity encoding",
    tone: "var(--doc-ochre)",
    blurb:
      "The model produced matching faces above the control rate, but the separation is smaller or noisier. Treat as indicative, not conclusive.",
  },
  weak: {
    label: "Weak / inconclusive",
    tone: "var(--doc-ochre)",
    blurb:
      "A small target-over-control difference was seen but does not clear the bar for an identity-encoding claim.",
  },
  none: {
    label: "No encoding detected",
    tone: "var(--doc-muted)",
    blurb:
      "Under this protocol the model did not reproduce the talent's likeness above the control baseline.",
  },
};

export interface RenderReportInput {
  runId: string;
  docRef: string;
  target: ProbeTarget;
  protocol: ProbeProtocol;
  verdict: ProbeVerdict;
  generatedAt: number;
  /** Hash-covered "run completed at" from the ledger payload, not DB createdAt. */
  ledgerCompletedAtIso: string | null;
  manifestSha256: string | null;
  sampleCounts: { generated: number; scored: number };
  referenceCount: number;
  seal: { ref: string; sealHash: string; verifyPath: string } | null;
  /** Talent initials + short code only — safe for the public seal page. */
  subjectLabel: string;
}

function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}

function conditionLabel(c: string): string {
  switch (c) {
    case "target":
      return "Target (name / trigger)";
    case "control_distractor":
      return "Control — distractor names";
    case "control_baseline":
      return "Control — no name";
    default:
      return c;
  }
}

export function renderLikenessEncodingReport(d: RenderReportInput): string {
  const enc = ENCODING_COPY[d.verdict.encoding];
  const conditionRows = d.verdict.conditions
    .map(
      (c) =>
        `<tr><td>${esc(conditionLabel(c.condition))}</td><td>${c.scored}</td><td>${pct(
          c.matchRate
        )}</td><td>${c.meanSimilarity == null ? "—" : pct(c.meanSimilarity)}</td><td>${
          c.maxSimilarity == null ? "—" : pct(c.maxSimilarity)
        }</td><td>${c.phashMatches}</td></tr>`
    )
    .join("");

  const seeds = d.protocol.seeds.join(", ");
  const templates = d.protocol.promptTemplates
    .map((t) => `<li><code>${esc(t)}</code></li>`)
    .join("");
  const distractors = d.protocol.distractorNames.map(esc).join(", ");
  const trained = d.protocol.trainedWords.length ? d.protocol.trainedWords.map(esc).join(", ") : "—";

  const scanMembership = d.verdict.scanMembershipSignal
    ? `<p class="flag"><strong>Scan-membership signal.</strong> ${d.verdict.phashRegurgitations} generated image(s) perceptually matched a still held only in this vault (Hamming ≤ ${d.protocol.phashDerivationThreshold}). Reproduction of vault-held imagery is the one result in this report that speaks to training on the scans themselves, not merely on public photographs — see the limits note below before relying on it.</p>`
    : `<p class="muted">No generated image matched a vault still under the derivation threshold. This report therefore speaks to identity encoding only, not to training on the vault scans specifically.</p>`;

  const sealBlock = d.seal
    ? `<div class="seal">
  <strong>Tamper seal.</strong> This report is bound to an append-only compliance ledger. Its "run completed" time, the tested file's hash, and the manifest hash are written <em>inside</em> the hashed ledger entries, so altering any of them breaks verification.
  <span class="seal-hash">${esc(quads(d.seal.sealHash) || "(empty chain)")}</span>
  Anyone may verify this document, without an account, at <code>${esc(d.seal.verifyPath)}</code>
</div>`
    : `<div class="seal" style="border-left-color:var(--doc-ochre);background:var(--doc-ochre-tint)">
  <strong>Unsealed draft.</strong> This run has not yet been sealed to the ledger; treat it as provisional.
</div>`;

  const when = isoUtc(d.generatedAt);

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<title>Likeness Encoding Report ${esc(d.docRef)}</title>
<style>
  ${DOC_CSS_VARS}
  body{font-family:var(--doc-sans);color:var(--doc-text);max-width:900px;margin:40px auto;padding:0 24px;line-height:1.55;background:var(--doc-paper)}
  h1{font-family:var(--doc-serif);font-size:24px;font-weight:600;letter-spacing:-0.01em;color:var(--doc-ink);margin:0 0 4px}
  h2{font-size:9px;text-transform:uppercase;letter-spacing:.25em;font-weight:700;color:var(--doc-muted);margin:32px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--doc-rule)}
  .muted{color:var(--doc-muted);font-size:13px}
  table{width:100%;border-collapse:collapse;font-size:13px;margin-top:6px}
  th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--doc-rule)}
  th{color:var(--doc-muted);font-weight:700;font-size:9px;text-transform:uppercase;letter-spacing:.1em}
  code{font-family:var(--doc-mono);font-size:11.5px}
  ul{margin:6px 0 0;padding-left:18px} li{font-size:12.5px;margin:3px 0}
  .verdict{margin:18px 0;padding:16px;border:1px solid var(--doc-rule);border-left:4px solid ${enc.tone};border-radius:6px;background:var(--doc-inset)}
  .verdict .label{font-family:var(--doc-serif);font-size:18px;font-weight:600;color:${enc.tone}}
  .stat{display:inline-block;margin-right:24px;font-size:13px} .stat b{display:block;font-size:20px;color:var(--doc-ink);font-family:var(--doc-mono)}
  .flag{margin:12px 0;padding:12px;border:1px solid var(--doc-rule);border-left:3px solid var(--doc-brick);background:var(--doc-brick-tint);font-size:12.5px;border-radius:4px}
  .limits{margin-top:8px;padding:12px 14px;background:var(--doc-inset);border:1px solid var(--doc-rule);border-radius:4px;font-size:12px}
  .limits li{color:var(--doc-text)}
  .seal{margin-top:24px;padding:14px;border:1px solid var(--doc-rule);border-left:3px solid var(--doc-olive);border-radius:6px;background:var(--doc-olive-tint);font-size:12px}
  .seal-hash{display:block;margin:6px 0;font-family:var(--doc-mono);font-size:11px;letter-spacing:.02em;color:var(--doc-olive);word-break:break-word}
  @media print{ @page{size:A4;margin:18mm 16mm 20mm} .verdict,.seal,.flag,tr{break-inside:avoid} }
</style></head><body>
<h1>Likeness Encoding Report</h1>
<p class="muted">${esc(d.docRef)} · subject ${esc(d.subjectLabel)} · generated ${esc(when)}</p>

<div class="verdict">
  <div class="label">${esc(enc.label)}</div>
  <p style="margin:8px 0 12px">${esc(enc.blurb)}</p>
  <span class="stat"><b>${pct(d.verdict.targetMatchRate)}</b>target match rate</span>
  <span class="stat"><b>${pct(d.verdict.controlMatchRate)}</b>control match rate</span>
  <span class="stat"><b>${(d.verdict.rateDifference * 100).toFixed(0)} pts</b>difference</span>
  <span class="stat"><b>${d.verdict.fisherP < 0.001 ? "&lt;0.001" : d.verdict.fisherP.toFixed(3)}</b>Fisher's exact p</span>
</div>

${scanMembership}

<h2>Target under test</h2>
<p class="muted">
  ${esc(d.target.displayName ?? d.target.ref)} · ${esc(d.target.kind === "civitai_lora" ? "downloadable model" : "hosted model")} · ref <code>${esc(d.target.ref)}</code><br/>
  file SHA-256: <code>${d.target.fileSha256 ? esc(shortHash(d.target.fileSha256, 16)) : "not published by source"}</code><br/>
  trigger words: ${trained} · base model: ${esc(d.target.meta?.baseModel ?? "—")} · published: ${esc(d.target.meta?.publishedAt ?? "—")}
</p>

<h2>Result by condition</h2>
<table><thead><tr><th>Condition</th><th>Scored</th><th>Match rate</th><th>Mean sim.</th><th>Max sim.</th><th>pHash hits</th></tr></thead>
<tbody>${conditionRows}</tbody></table>
<p class="muted">Match threshold: face similarity ≥ ${pct(d.verdict.matchThreshold)}. A "match" is one generated image the identity provider scored at or above that bar against a probe-grade vault reference.</p>

<h2>Protocol (pre-registered)</h2>
<p class="muted">Version <code>${esc(d.protocol.version)}</code>. Fixed before any image was generated and frozen into the run manifest. Prompt templates ({subject} substituted per condition):</p>
<ul>${templates}</ul>
<p class="muted">Seeds (identical across every condition): <code>${esc(seeds)}</code>. Distractor identities: ${distractors}. Baseline: "<code>${esc(d.protocol.baselineDescriptor)}</code>". References compared against: ${d.referenceCount} probe-grade vault still(s). Samples generated: ${d.sampleCounts.generated} / scored: ${d.sampleCounts.scored}.</p>

<h2>What this report does and does not establish</h2>
<div class="limits"><ul>
  <li><strong>Establishes:</strong> that the tested model, prompted with this identity, reproduces the talent's likeness above a control baseline under a fixed, reproducible protocol.</li>
  <li><strong>Does not establish, by name-fidelity alone:</strong> that the model was trained on this vault's scans. High name→likeness fidelity is consistent with training on public photographs. Only a scan-membership signal (above) speaks to the scans themselves — and dHash matching detects reproduction/regurgitation, not all forms of memorisation.</li>
  <li><strong>Identity similarity is a third-party score</strong> (AWS Rekognition), not a forensic identification. It is meaningful here only <em>relative to</em> the control cohort generated under identical conditions.</li>
  <li>This is a sealed, reproducible technical record suitable for supporting a licensing discussion or handing to counsel — it is not a legal determination.</li>
</ul></div>

<p class="muted" style="margin-top:14px">Ledger-sealed completion time: <code>${esc(d.ledgerCompletedAtIso ?? "—")}</code> · manifest SHA-256: <code>${d.manifestSha256 ? esc(shortHash(d.manifestSha256, 16)) : "—"}</code></p>

${sealBlock}
</body></html>`;
}

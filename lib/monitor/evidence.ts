/**
 * Likeness Evidence Record — the printable artefact for one flagged hit.
 *
 * Until now the only place a hit's full evidence set was ever assembled was
 * the admin-triggered takedown email, which the talent never sees. This is
 * the talent-facing (and rep-facing) equivalent: everything Image Vault holds
 * about one piece of flagged content on a single page a rep can print, attach
 * to correspondence, or hand to counsel.
 *
 * It shares the document grammar in lib/documents/palette.ts with the custody
 * record, consent receipt and compliance certificate — rendered server-side
 * as a standalone HTML string, on demand, never stored. Two honesty rules the
 * copy must keep:
 *   - a null detector reading prints as "not measured", never as a zero;
 *   - the footer states plainly that readings are automated detector output,
 *     not certified forensic analysis.
 */

import { and, asc, eq } from "drizzle-orm";
import type { getDb } from "@/lib/db";
import {
  likenessHits,
  monitorAccounts,
  monitorScans,
  takedownSubmissions,
  talentProfiles,
} from "@/lib/db/schema";
import { DOC, DOC_CSS_VARS, DOC_PRINT_CSS, docRef, isoUtc } from "@/lib/documents/palette";
import { platformName } from "./platforms";
import { parseDetectorReadings, type DetectorReadings } from "./types";

type Db = ReturnType<typeof getDb>;

// ── Data assembly ───────────────────────────────────────────────────────────

export interface EvidenceRecordData {
  hit: typeof likenessHits.$inferSelect;
  talentName: string;
  knownForTitles: string[];
  readings: DetectorReadings | null;
  matchSignals: string[];
  scan: {
    id: string;
    startedAt: number;
    completedAt: number | null;
    platformsChecked: number;
    candidatesAnalysed: number;
    aiProvider: string | null;
    coverageTier: string | null;
    coverageScore: number | null;
  } | null;
  account: {
    handle: string;
    displayName: string | null;
    followerCount: number | null;
    cumulativeViews: number;
    hitCount: number;
    status: string;
  } | null;
  takedowns: Array<{
    method: string;
    recipient: string;
    sentAt: number;
    platformStatus: string;
    platformReference: string | null;
  }>;
  /** data: URI of the captured still; absent when none stored or NSFW. */
  stillDataUri: string | null;
  stillWithheld: boolean;
  generatedAt: number;
}

/** Load everything the record needs. Returns null when the hit doesn't exist. */
export async function loadEvidenceRecord(
  db: Db,
  hitId: string,
  opts: { bucket?: R2Bucket }
): Promise<EvidenceRecordData | null> {
  const hit = await db.select().from(likenessHits).where(eq(likenessHits.id, hitId)).get();
  if (!hit) return null;

  const [profile, scan, account, takedowns] = await Promise.all([
    db
      .select({ fullName: talentProfiles.fullName, knownFor: talentProfiles.knownFor })
      .from(talentProfiles)
      .where(eq(talentProfiles.userId, hit.talentId))
      .get(),
    db.select().from(monitorScans).where(eq(monitorScans.id, hit.scanId)).get(),
    hit.accountId
      ? db.select().from(monitorAccounts).where(eq(monitorAccounts.id, hit.accountId)).get()
      : Promise.resolve(undefined),
    db
      .select({
        method: takedownSubmissions.method,
        recipient: takedownSubmissions.recipient,
        sentAt: takedownSubmissions.sentAt,
        platformStatus: takedownSubmissions.platformStatus,
        platformReference: takedownSubmissions.platformReference,
      })
      .from(takedownSubmissions)
      .where(and(eq(takedownSubmissions.hitId, hitId), eq(takedownSubmissions.talentId, hit.talentId)))
      .orderBy(asc(takedownSubmissions.sentAt))
      .all(),
  ]);

  // Evidence still: embedded as a data URI so the printed record is
  // self-contained. NSFW content is withheld from the document by policy —
  // the record says so and points back to the vault.
  let stillDataUri: string | null = null;
  const stillWithheld = hit.nsfw === true && !!hit.thumbnailKey;
  if (!hit.nsfw && hit.thumbnailKey && opts.bucket) {
    try {
      const object = await opts.bucket.get(hit.thumbnailKey);
      if (object) {
        const bytes = new Uint8Array(await object.arrayBuffer());
        const contentType = object.httpMetadata?.contentType ?? "image/jpeg";
        stillDataUri = `data:${contentType};base64,${base64(bytes)}`;
      }
    } catch {
      // The record stands without the still.
    }
  }

  return {
    hit,
    talentName: profile?.fullName ?? "Unknown talent",
    knownForTitles: parseKnownFor(profile?.knownFor),
    readings: parseDetectorReadings(hit.detectorReadingsJson),
    matchSignals: parseStringArray(hit.matchSignalsJson),
    scan: scan
      ? {
          id: scan.id,
          startedAt: scan.startedAt,
          completedAt: scan.completedAt,
          platformsChecked: scan.platformsChecked,
          candidatesAnalysed: scan.candidatesAnalysed,
          aiProvider: scan.aiProvider,
          coverageTier: scan.coverageTier,
          coverageScore: scan.coverageScore,
        }
      : null,
    account: account
      ? {
          handle: account.handle,
          displayName: account.displayName,
          followerCount: account.followerCount,
          cumulativeViews: account.cumulativeViews,
          hitCount: account.hitCount,
          status: account.status,
        }
      : null,
    takedowns,
    stillDataUri,
    stillWithheld,
    generatedAt: Math.floor(Date.now() / 1000),
  };
}

function parseKnownFor(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((k) => (k && typeof k === "object" && "title" in k ? String((k as { title: unknown }).title) : ""))
      .filter(Boolean)
      .slice(0, 5);
  } catch {
    return [];
  }
}

function parseStringArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** Chunked base64 — String.fromCharCode(...bytes) overflows the arg limit. */
function base64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// ── Rendering ───────────────────────────────────────────────────────────────

function esc(value: string | null | undefined): string {
  return (value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const HIT_STATUS_LABEL: Record<string, string> = {
  new: "Awaiting review",
  confirmed: "Confirmed by talent",
  dismissed: "Dismissed",
  takedown_requested: "Takedown requested",
  resolved: "Resolved",
};

interface ReadingRow {
  label: string;
  value: string | null;
  interpretation: string;
  strong: boolean;
}

/**
 * Thresholds mirror the adjudicator's brief (scan.ts ADJUDICATOR_SYSTEM):
 * face >=0.8 strong / <0.7 weak; pHash <=16 derivation; fingerprint >=0.7
 * licensed-data provenance; synthetic >=0.7 likely AI-generated.
 */
function readingRows(r: DetectorReadings | null): ReadingRow[] {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const face = r?.faceEmbeddingSimilarity ?? null;
  const phash = r?.perceptualHashDistance ?? null;
  const fp = r?.geometryFingerprintCorrelation ?? null;
  const syn = r?.syntheticMediaScore ?? null;
  return [
    {
      label: "Face similarity vs vault references",
      value: face === null ? null : pct(face),
      interpretation:
        face === null
          ? "No reading taken — not evidence for or against."
          : face >= 0.8
            ? "Strong likeness match against verified reference imagery."
            : face < 0.7
              ? "Weak match — consistent with a lookalike or unrelated person."
              : "Probable likeness match.",
      strong: face !== null && face >= 0.8,
    },
    {
      label: "Derivation distance (perceptual hash, 0–64)",
      value: phash === null ? null : `${phash}`,
      interpretation:
        phash === null
          ? "No reading taken — not evidence for or against."
          : phash <= 16
            ? "Within derivation threshold — content derives from the talent's vault imagery."
            : "No derivation from vault imagery detected.",
      strong: phash !== null && phash <= 16,
    },
    {
      label: "Geometry fingerprint correlation",
      value: fp === null ? null : pct(fp),
      interpretation:
        fp === null
          ? "No reading taken — not evidence for or against."
          : fp >= 0.7
            ? "Correlates with fingerprint bits watermarked into licensed deliveries — the talent's actual scan data was used."
            : "No correlation with licensed scan data.",
      strong: fp !== null && fp >= 0.7,
    },
    {
      label: "Synthetic-media score",
      value: syn === null ? null : pct(syn),
      interpretation:
        syn === null
          ? "No reading taken — not evidence for or against."
          : syn >= 0.7
            ? "Content is likely AI-generated or AI-modified."
            : "No strong indication of synthetic generation.",
      strong: syn !== null && syn >= 0.7,
    },
  ];
}

function parseDiscoverySource(stored: string | null): string | null {
  if (!stored) return null;
  const idx = stored.indexOf(":");
  if (idx === -1) return stored;
  const mode = stored.slice(0, idx);
  const query = stored.slice(idx + 1);
  const modeLabel: Record<string, string> = {
    hashtag: "hashtag search",
    user_search: "user search",
    account: "watched account",
    simulated: "simulated crawl",
  };
  return `${modeLabel[mode] ?? mode} "${query}"`;
}

export function renderEvidenceRecordHtml(d: EvidenceRecordData): string {
  const { hit } = d;
  const ref = docRef("EVR", hit.detectedAt, hit.id);
  const statusLabel = HIT_STATUS_LABEL[hit.status] ?? hit.status;
  const discovery = parseDiscoverySource(hit.discoverySource);
  const rows = readingRows(d.readings);

  const readingRowsHtml = rows
    .map(
      (row) => `<tr class="doc-keep">
  <td>${esc(row.label)}</td>
  <td class="mono" style="${row.value === null ? `color:${DOC.faint}` : row.strong ? `color:${DOC.brick};font-weight:700` : ""}">${row.value === null ? "not measured" : esc(row.value)}</td>
  <td class="muted">${esc(row.interpretation)}</td>
</tr>`
    )
    .join("");

  const signalsHtml = d.matchSignals.length
    ? `<ul class="signals">${d.matchSignals.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>`
    : `<p class="muted">No structured match signals recorded.</p>`;

  const syntheticHtml =
    d.readings?.synthetic && (d.readings.synthetic.generatorFamily || d.readings.synthetic.evidence.length)
      ? `<p class="forensic doc-keep"><strong>Forensic observations (${esc(d.readings.synthetic.analyst)}):</strong> ${
          d.readings.synthetic.generatorFamily ? `resembles ${esc(d.readings.synthetic.generatorFamily)}` : ""
        }${d.readings.synthetic.generatorFamily && d.readings.synthetic.evidence.length ? " — " : ""}${d.readings.synthetic.evidence
          .map(esc)
          .join("; ")}</p>`
      : "";

  const stillHtml = d.stillDataUri
    ? `<figure class="still doc-keep"><img src="${d.stillDataUri}" alt="Captured still of the flagged content"/><figcaption>Still captured by the sweep at detection time and preserved in the vault.</figcaption></figure>`
    : d.stillWithheld
      ? `<p class="muted doc-keep">Evidence still withheld from this record — the platform flags this content as adult material. The preserved copy remains available in the vault.</p>`
      : `<p class="muted doc-keep">No evidence still was captured for this hit.</p>`;

  const takedownRows = d.takedowns
    .map(
      (t) => `<tr class="doc-keep">
  <td>${esc(isoUtc(t.sentAt))}</td>
  <td>${esc(t.method)} to ${esc(t.recipient)}</td>
  <td>${esc(t.platformStatus)}${t.platformReference ? ` · ref ${esc(t.platformReference)}` : ""}</td>
</tr>`
    )
    .join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>Likeness Evidence Record ${esc(ref)}</title>
<style>
  ${DOC_CSS_VARS}
  body{font-family:var(--doc-sans);color:var(--doc-text);max-width:820px;margin:40px auto;padding:0 24px;line-height:1.55;background:var(--doc-paper)}
  header{display:flex;justify-content:space-between;align-items:baseline;gap:16px;border-bottom:2px solid var(--doc-ink);padding-bottom:14px}
  h1{font-family:var(--doc-serif);font-size:26px;font-weight:600;letter-spacing:-0.01em;color:var(--doc-ink);margin:0}
  .wordmark{font-family:var(--doc-serif);font-size:13px;color:var(--doc-ink);letter-spacing:.02em}
  .ref{font-family:var(--doc-mono);font-size:11px;color:var(--doc-muted)}
  h2{font-size:9px;text-transform:uppercase;letter-spacing:.25em;font-weight:700;color:var(--doc-muted);margin:30px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--doc-rule)}
  .muted{color:var(--doc-muted);font-size:12px}
  .mono{font-family:var(--doc-mono);font-size:12px}
  table{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:4px}
  th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--doc-rule);vertical-align:top}
  th{color:var(--doc-muted);font-weight:700;font-size:9px;text-transform:uppercase;letter-spacing:.1em}
  dl{display:grid;grid-template-columns:190px 1fr;gap:4px 14px;margin:6px 0;font-size:12.5px}
  dt{color:var(--doc-muted)}
  dd{margin:0;color:var(--doc-ink);overflow-wrap:anywhere}
  .risk{display:inline-block;padding:1px 8px;border-radius:999px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em}
  .caption{font-size:12px;color:var(--doc-text);background:var(--doc-inset);padding:8px 10px;border-left:2px solid var(--doc-rule);margin:6px 0}
  .signals{margin:6px 0 0;padding-left:18px;font-size:12px;color:var(--doc-text)}
  .signals li{margin-bottom:2px}
  .forensic{font-size:12px;background:var(--doc-inset);padding:8px 10px;border-left:2px solid var(--doc-ochre);margin:8px 0 0}
  .still{margin:10px 0 0}
  .still img{max-width:240px;max-height:320px;border:1px solid var(--doc-rule);border-radius:4px;display:block}
  .still figcaption{font-size:10.5px;color:var(--doc-muted);margin-top:4px;max-width:240px}
  .adjudication{background:var(--doc-inset);border:1px solid var(--doc-rule);border-radius:4px;padding:10px 12px;font-size:12.5px;margin-top:6px}
  footer{margin-top:34px;padding-top:12px;border-top:1px solid var(--doc-rule);font-size:10.5px;color:var(--doc-muted);line-height:1.6}
  .print-hint{font-size:11px;color:var(--doc-muted);text-align:right;margin:10px 0 0}
  .print-hint button{font:inherit;color:var(--doc-ink);background:none;border:1px solid var(--doc-rule);border-radius:4px;padding:4px 12px;cursor:pointer}
  ${DOC_PRINT_CSS}
</style></head><body>
<div class="print-hint no-print"><button onclick="window.print()">Print / save as PDF</button></div>
<header class="doc-keep">
  <div>
    <h1>Likeness Evidence Record</h1>
    <p class="ref">${esc(ref)} · generated ${esc(isoUtc(d.generatedAt))}</p>
  </div>
  <span class="wordmark">Image Vault</span>
</header>

<h2>Protected identity</h2>
<dl class="doc-keep">
  <dt>Talent</dt><dd>${esc(d.talentName)}</dd>
  ${d.knownForTitles.length ? `<dt>Known for</dt><dd>${esc(d.knownForTitles.join(" · "))}</dd>` : ""}
  ${
    d.scan?.coverageTier
      ? `<dt>Detection coverage at sweep</dt><dd>${esc(d.scan.coverageTier)}${d.scan.coverageScore != null ? ` · ${d.scan.coverageScore}/100` : ""}</dd>`
      : ""
  }
</dl>

<h2>Flagged content</h2>
<dl class="doc-keep">
  <dt>Platform</dt><dd>${esc(platformName(hit.platform))} (${esc(hit.contentType)})</dd>
  <dt>URL</dt><dd class="mono">${esc(hit.contentUrl)}</dd>
  <dt>Posted by</dt><dd>${esc(hit.authorHandle ?? "unknown account")}${
    d.account
      ? ` — ${[
          d.account.displayName ? esc(d.account.displayName) : null,
          d.account.followerCount != null ? `${d.account.followerCount.toLocaleString("en-GB")} followers` : null,
          `${d.account.hitCount} recorded hit${d.account.hitCount === 1 ? "" : "s"}`,
          `${d.account.cumulativeViews.toLocaleString("en-GB")} cumulative views`,
          `account status: ${esc(d.account.status)}`,
        ]
          .filter(Boolean)
          .join(", ")}`
      : ""
  }</dd>
  <dt>Detected</dt><dd>${esc(isoUtc(hit.detectedAt))}</dd>
  ${discovery ? `<dt>Surfaced by</dt><dd>${esc(discovery)}</dd>` : ""}
  ${hit.nsfw ? `<dt>Content warning</dt><dd>Platform-declared adult content (NSFW)</dd>` : ""}
</dl>
${hit.caption ? `<p class="caption doc-keep">&ldquo;${esc(hit.caption)}&rdquo;</p>` : ""}
${stillHtml}

<h2>Detector readings</h2>
<table>
<thead><tr><th style="width:230px">Detector</th><th style="width:100px">Reading</th><th>Interpretation</th></tr></thead>
<tbody>${readingRowsHtml}</tbody>
</table>
${syntheticHtml}
${
  d.readings?.vigilanceMatchTerm
    ? `<p class="muted" style="margin-top:6px">Identity evidence for discovery was role vocabulary from an open announcement window (&ldquo;${esc(d.readings.vigilanceMatchTerm)}&rdquo;), not the talent's name.</p>`
    : ""
}

<h2>Adjudication</h2>
<div class="adjudication doc-keep">
  <dl style="margin:0">
    <dt>Likeness match confidence</dt><dd>${hit.confidence}%</dd>
    <dt>AI-generated likelihood</dt><dd>${hit.aiGeneratedLikelihood}%</dd>
    <dt>Risk level</dt><dd><span class="risk" style="color:${DOC.brick};background:${DOC.brickTint}">${esc(hit.riskLevel)}</span></dd>
    <dt>Adjudicated by</dt><dd>${d.scan?.aiProvider === "ai" ? "AI adjudicator (reasoning on record below)" : d.scan?.aiProvider === "heuristic" ? "Heuristic thresholds" : "—"}</dd>
  </dl>
  ${hit.aiRationale ? `<p style="margin:8px 0 0"><strong>Rationale:</strong> ${esc(hit.aiRationale)}</p>` : ""}
</div>
${signalsHtml}

<h2>Sweep context</h2>
<dl class="doc-keep">
  ${d.scan ? `<dt>Sweep</dt><dd class="mono">${esc(d.scan.id)}</dd>
  <dt>Ran</dt><dd>${esc(isoUtc(d.scan.startedAt))}${d.scan.completedAt ? ` – ${esc(isoUtc(d.scan.completedAt))}` : ""}</dd>
  <dt>Scope</dt><dd>${d.scan.platformsChecked} platform${d.scan.platformsChecked === 1 ? "" : "s"} swept · ${d.scan.candidatesAnalysed} candidate${d.scan.candidatesAnalysed === 1 ? "" : "s"} analysed</dd>` : `<dt>Sweep</dt><dd>Record unavailable</dd>`}
</dl>

<h2>Case history</h2>
<dl class="doc-keep">
  <dt>Current status</dt><dd>${esc(statusLabel)}${hit.statusUpdatedAt ? ` · updated ${esc(isoUtc(hit.statusUpdatedAt))}` : ""}</dd>
</dl>
${
  d.takedowns.length
    ? `<table><thead><tr><th style="width:180px">Filed</th><th>Submission</th><th>Platform response</th></tr></thead><tbody>${takedownRows}</tbody></table>`
    : `<p class="muted">No takedown has been filed for this content through Image Vault.</p>`
}

<footer class="doc-keep">
  This record reflects the data held by Image Vault at generation time. Detector readings are the
  output of automated detection systems and are provided as investigative evidence, not as certified
  forensic analysis. A reading marked &ldquo;not measured&rdquo; means the detector took no reading —
  it is not evidence for or against the content. Reference: <span class="mono">${esc(ref)}</span>.
</footer>
</body></html>`;
}

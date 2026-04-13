export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { licences, scanPackages, scanFiles, users, talentProfiles } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { isAdmin } from "@/lib/auth/adminEmails";
import { eq, and, count } from "drizzle-orm";

const LICENCE_TYPE_LABELS: Record<string, string> = {
  film_double: "Film / Digital Double",
  game_character: "Game Character / Interactive Media",
  commercial: "Commercial / Advertising",
  ai_avatar: "AI Avatar / Virtual Self",
  training_data: "AI / Machine Learning Training Data",
  monitoring_reference: "Identity Verification / Security Reference",
};

const EXCLUSIVITY_LABELS: Record<string, string> = {
  non_exclusive: "Non-Exclusive",
  sole: "Sole",
  exclusive: "Exclusive",
};

const PERMITTED_USE_PHRASES: Record<string, string> = {
  film_double: "the creation of visual effects, digital doubles, and promotional materials",
  game_character: "the creation of interactive media assets, game characters, and promotional materials",
  commercial: "the creation of commercial, advertising, and promotional materials",
  ai_avatar: "the creation of AI-generated avatar content and associated materials",
  training_data: "AI and machine learning model training and evaluation",
  monitoring_reference: "identity verification and security reference purposes",
};

function fmtDate(unix: number | null): string {
  if (!unix) return "—";
  return new Date(unix * 1000).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });
}

function fmtGBP(pence: number | null): string {
  if (!pence) return "Not specified";
  return `$${(pence / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

function contractRef(licenceId: string, approvedAt: number | null): string {
  const year = approvedAt ? new Date(approvedAt * 1000).getFullYear() : new Date().getFullYear();
  return `IV-${year}-${licenceId.slice(0, 8).toUpperCase()}`;
}

// GET /api/licences/[id]/contract — returns a print-ready HTML licence agreement
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { id } = await params;
  const db = getDb();

  const lic = await db
    .select()
    .from(licences)
    .where(eq(licences.id, id))
    .get();

  if (!lic) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isOwner = lic.talentId === session.sub || lic.licenseeId === session.sub;
  const admin = isAdmin(session.email);
  if (!isOwner && !admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Fetch related records in parallel
  const [pkg, talentUser, talentProfile, licenseeUser, fileCount] = await Promise.all([
    db.select().from(scanPackages).where(eq(scanPackages.id, lic.packageId)).get(),
    db.select({ email: users.email }).from(users).where(eq(users.id, lic.talentId)).get(),
    db.select({ fullName: talentProfiles.fullName }).from(talentProfiles).where(eq(talentProfiles.userId, lic.talentId)).get(),
    db.select({ email: users.email }).from(users).where(eq(users.id, lic.licenseeId)).get(),
    db.select({ count: count() }).from(scanFiles)
      .where(and(eq(scanFiles.packageId, lic.packageId), eq(scanFiles.uploadStatus, "complete")))
      .get(),
  ]);

  const ref = contractRef(id, lic.approvedAt);
  const talentName = talentProfile?.fullName ?? talentUser?.email ?? "Unknown Talent";
  const licenceTypeLabel = lic.licenceType ? (LICENCE_TYPE_LABELS[lic.licenceType] ?? lic.licenceType) : "General Licence";
  const exclusivityLabel = lic.exclusivity ? (EXCLUSIVITY_LABELS[lic.exclusivity] ?? lic.exclusivity) : "Non-Exclusive";
  const agreedFee = lic.agreedFee ?? lic.proposedFee;
  const platformFee = lic.platformFee ?? (agreedFee ? Math.round(agreedFee * 0.15) : null);
  const talentFee = agreedFee && platformFee ? agreedFee - platformFee : null;
  const fileCountNum = fileCount?.count ?? 0;
  const permittedUsePhrase = lic.licenceType ? (PERMITTED_USE_PHRASES[lic.licenceType] ?? "the Permitted Use") : "the Permitted Use";

  const isDraft = lic.status !== "APPROVED";
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Biometric Likeness Licence Agreement — ${ref}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --ink: #111;
    --muted: #555;
    --border: #ccc;
    --light: #f4f4f4;
  }

  body {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 10.5pt;
    line-height: 1.65;
    color: var(--ink);
    background: #fff;
    max-width: 800px;
    margin: 0 auto;
    padding: 48px 56px;
  }

  /* ── Cover page ────────────────────────────────── */
  .cover {
    min-height: 90vh;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding-bottom: 40px;
    border-bottom: 3px solid var(--ink);
    margin-bottom: 60px;
  }
  .cover-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 80px;
  }
  .cover-wordmark {
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 13pt;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .cover-ref {
    font-family: 'Courier New', monospace;
    font-size: 9pt;
    color: var(--muted);
    text-align: right;
    line-height: 1.6;
  }
  .cover-title {
    text-align: center;
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 60px 0;
  }
  .cover-title h1 {
    font-size: 22pt;
    font-weight: 700;
    letter-spacing: -0.01em;
    line-height: 1.2;
    margin-bottom: 12px;
    text-transform: uppercase;
  }
  .cover-title .subtitle {
    font-size: 11pt;
    color: var(--muted);
    font-style: italic;
  }
  .cover-parties {
    display: grid;
    grid-template-columns: 1fr 48px 1fr;
    gap: 0;
    margin-bottom: 48px;
  }
  .cover-party {
    padding: 24px;
    border: 1px solid var(--border);
    background: var(--light);
  }
  .cover-party:first-child { border-right: none; }
  .cover-between {
    display: flex;
    align-items: center;
    justify-content: center;
    border-top: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    font-size: 8pt;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    writing-mode: vertical-rl;
    text-orientation: mixed;
  }
  .cover-party-role {
    font-family: system-ui, sans-serif;
    font-size: 7.5pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--muted);
    margin-bottom: 6px;
  }
  .cover-party-name {
    font-size: 11pt;
    font-weight: 700;
    margin-bottom: 4px;
  }
  .cover-party-detail {
    font-size: 9pt;
    color: var(--muted);
    line-height: 1.5;
  }
  .cover-meta {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1px;
    background: var(--border);
    border: 1px solid var(--border);
    font-size: 9pt;
  }
  .cover-meta-cell {
    background: #fff;
    padding: 12px 16px;
  }
  .cover-meta-cell .label {
    font-family: system-ui, sans-serif;
    font-size: 7pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--muted);
    margin-bottom: 4px;
  }
  .cover-meta-cell .value {
    font-weight: 600;
  }

  /* ── Draft watermark ───────────────────────────── */
  ${isDraft ? `
  body::before {
    content: "DRAFT";
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-35deg);
    font-family: system-ui, sans-serif;
    font-size: 140pt;
    font-weight: 900;
    color: rgba(0,0,0,0.04);
    pointer-events: none;
    z-index: 0;
    white-space: nowrap;
  }` : ""}

  /* ── Body content ─────────────────────────────── */
  .section {
    margin-bottom: 36px;
    position: relative;
    z-index: 1;
  }
  .section-title {
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 9pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--ink);
    padding-bottom: 6px;
    border-bottom: 1.5px solid var(--ink);
    margin-bottom: 16px;
  }
  .section-number {
    color: var(--muted);
    margin-right: 8px;
  }
  h2 { font-size: 10.5pt; }

  p { margin-bottom: 10px; }
  p:last-child { margin-bottom: 0; }

  .clause {
    display: grid;
    grid-template-columns: 28px 1fr;
    gap: 0 8px;
    margin-bottom: 10px;
  }
  .clause-num {
    color: var(--muted);
    font-size: 9.5pt;
    padding-top: 1px;
    white-space: nowrap;
  }
  .clause-body { }

  .sub-clause {
    display: grid;
    grid-template-columns: 44px 1fr;
    gap: 0 8px;
    margin-bottom: 8px;
    padding-left: 28px;
  }
  .sub-clause .clause-num { font-size: 9pt; }

  /* ── Definition table ─────────────────────────── */
  .def-table { width: 100%; border-collapse: collapse; margin: 8px 0 12px; font-size: 9.5pt; }
  .def-table td { padding: 6px 10px; vertical-align: top; border-bottom: 1px solid #eee; }
  .def-table td:first-child {
    font-weight: 700;
    width: 170px;
    white-space: nowrap;
    color: var(--ink);
  }
  .def-table td:last-child { color: #222; }

  /* ── Schedule / data table ────────────────────── */
  .data-table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 9.5pt; border: 1px solid var(--border); }
  .data-table th {
    background: var(--light);
    padding: 8px 12px;
    text-align: left;
    font-family: system-ui, sans-serif;
    font-size: 7.5pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    border-bottom: 1px solid var(--border);
  }
  .data-table td {
    padding: 8px 12px;
    vertical-align: top;
    border-bottom: 1px solid #eee;
  }
  .data-table tr:last-child td { border-bottom: none; }
  .data-table td:first-child { color: var(--muted); font-size: 9pt; width: 200px; }
  .data-table td:last-child { font-weight: 500; }

  /* ── Signature block ──────────────────────────── */
  .sig-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 40px;
    margin-top: 24px;
  }
  .sig-block { }
  .sig-party {
    font-family: system-ui, sans-serif;
    font-size: 7.5pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--muted);
    margin-bottom: 8px;
  }
  .sig-line {
    border-bottom: 1px solid var(--ink);
    height: 36px;
    margin-bottom: 6px;
  }
  .sig-label {
    font-size: 8pt;
    color: var(--muted);
    margin-bottom: 16px;
  }

  /* ── Notice box ───────────────────────────────── */
  .notice {
    border-left: 3px solid var(--ink);
    padding: 10px 16px;
    background: var(--light);
    margin: 12px 0;
    font-size: 9.5pt;
  }
  .notice.warning { border-color: #b45309; background: rgba(180,83,9,0.05); }

  /* ── Print ─────────────────────────────────────── */
  @media print {
    body { padding: 20mm 22mm; max-width: none; }
    .cover { page-break-after: always; min-height: auto; padding-bottom: 20mm; }
    .section { page-break-inside: avoid; }
    .sig-grid { page-break-inside: avoid; }
    .no-print { display: none !important; }

    @page {
      size: A4;
      margin: 18mm 20mm;
      @bottom-center {
        content: "CONFIDENTIAL  ·  ${ref}  ·  Page " counter(page) " of " counter(pages);
        font-size: 7pt;
        color: #999;
        font-family: system-ui, sans-serif;
      }
    }
  }

  /* ── Screen toolbar ────────────────────────────── */
  .toolbar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background: #111;
    color: #fff;
    padding: 10px 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-family: system-ui, sans-serif;
    font-size: 11px;
    z-index: 100;
    gap: 12px;
  }
  .toolbar-left { display: flex; align-items: center; gap: 16px; }
  .toolbar button {
    background: #fff;
    color: #111;
    border: none;
    padding: 6px 16px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    font-family: system-ui, sans-serif;
  }
  .toolbar .ref-chip {
    font-family: 'Courier New', monospace;
    font-size: 10px;
    background: rgba(255,255,255,0.1);
    padding: 3px 8px;
    border-radius: 3px;
  }
  .toolbar .status-chip {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 3px 8px;
    border-radius: 3px;
    background: ${isDraft ? "rgba(180,83,9,0.6)" : "rgba(22,101,52,0.6)"};
  }
  @media print { .toolbar { display: none; } }

  .content { padding-top: 52px; }
  @media print { .content { padding-top: 0; } }
</style>
</head>
<body>

<div class="toolbar no-print">
  <div class="toolbar-left">
    <span style="font-weight:700;letter-spacing:0.06em">CHANGLING</span>
    <span class="ref-chip">${ref}</span>
    <span class="status-chip">${isDraft ? "DRAFT — Not yet executed" : "APPROVED"}</span>
  </div>
  <div style="display:flex;gap:8px">
    <button onclick="window.print()">⬇ Save as PDF</button>
    <button onclick="window.close()" style="background:rgba(255,255,255,0.15);color:#fff">Close</button>
  </div>
</div>

<div class="content">

<!-- ══════════════════════════════════════════════════════════ -->
<!--  COVER PAGE                                               -->
<!-- ══════════════════════════════════════════════════════════ -->
<div class="cover">
  <div class="cover-header">
    <div class="cover-wordmark">Changling · Image Vault</div>
    <div class="cover-ref">
      Contract Reference: <strong>${ref}</strong><br>
      Date of Issue: ${today}<br>
      Status: ${isDraft ? "DRAFT" : "EXECUTED"}
    </div>
  </div>

  <div class="cover-title">
    <h1>Biometric Likeness<br>Licence Agreement</h1>
    <p class="subtitle">${licenceTypeLabel}</p>
  </div>

  <div class="cover-parties">
    <div class="cover-party">
      <div class="cover-party-role">Artist</div>
      <div class="cover-party-name">${talentName}</div>
      <div class="cover-party-detail">${talentUser?.email ?? ""}</div>
    </div>
    <div class="cover-between">and</div>
    <div class="cover-party">
      <div class="cover-party-role">Producer ("Licensee")</div>
      <div class="cover-party-name">${lic.productionCompany}</div>
      <div class="cover-party-detail">${licenseeUser?.email ?? ""}</div>
    </div>
  </div>

  <div class="cover-meta">
    <div class="cover-meta-cell">
      <div class="label">Project</div>
      <div class="value">${lic.projectName}</div>
    </div>
    <div class="cover-meta-cell">
      <div class="label">Licence Period</div>
      <div class="value">${fmtDate(lic.validFrom)} – ${fmtDate(lic.validTo)}</div>
    </div>
    <div class="cover-meta-cell">
      <div class="label">Territory</div>
      <div class="value">${lic.territory ?? "Worldwide"}</div>
    </div>
    <div class="cover-meta-cell">
      <div class="label">Exclusivity</div>
      <div class="value">${exclusivityLabel}</div>
    </div>
    <div class="cover-meta-cell">
      <div class="label">Agreed Fee</div>
      <div class="value">${fmtGBP(agreedFee)}</div>
    </div>
    <div class="cover-meta-cell">
      <div class="label">Approved</div>
      <div class="value">${fmtDate(lic.approvedAt)}</div>
    </div>
  </div>
</div>

<!-- ══════════════════════════════════════════════════════════ -->
<!--  RECITALS                                                 -->
<!-- ══════════════════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title"><span class="section-number">—</span>Recitals</div>
  <p>
    <strong>(A)</strong>&ensp;The Artist is a professional in the entertainment industry whose three-dimensional
    biometric likeness scan data (the "Licensed Material") is archived on the Changling Image Vault platform,
    a secure biometric asset management platform operated by Changling Ltd. ("Platform Operator").
  </p>
  <p>
    <strong>(B)</strong>&ensp;The Producer wishes to obtain a limited licence to use the Licensed Material in
    connection with the project described herein, and the Artist is willing to grant such a licence on
    the terms and conditions set out in this Agreement.
  </p>
  <p>
    <strong>(C)</strong>&ensp;Access to the Licensed Material is provided exclusively via the Platform's
    dual-custody verification mechanism, which requires authenticated confirmation by both parties before
    any file transfer takes place. This process forms part of the chain of custody and is recorded in the
    Platform's immutable audit log.
  </p>
  <p>
    NOW, THEREFORE, in consideration of the mutual covenants and promises set forth herein, and for other
    good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged, the
    parties agree as follows:
  </p>
</div>

<!-- ══════════════════════════════════════════════════════════ -->
<!--  1. DEFINITIONS                                           -->
<!-- ══════════════════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title"><span class="section-number">1.</span>Definitions</div>
  <p>In this Agreement, unless the context requires otherwise:</p>
  <table class="def-table">
    <tr><td>"Agreement"</td><td>means this Biometric Likeness Licence Agreement together with all Schedules and any written amendments agreed in writing by the parties.</td></tr>
    <tr><td>"Artist"</td><td>means the individual whose physical likeness is the subject of the Biometric Data, being <strong>${talentName}</strong>, identified on the Platform as the talent and licensor of the Licensed Material.</td></tr>
    <tr><td>"Biometric Data"</td><td>means all raw, untextured digital capture data relating to the Artist's physical likeness — including but not limited to 3D body scans, photogrammetry, voice samples, and Facial Action Coding System (FACS) data captured during the course of the Picture, as further described in Clause 9.1 and Schedule 1.</td></tr>
    <tr><td>"Effective Date"</td><td>means ${fmtDate(lic.approvedAt ?? lic.createdAt)}, being the date on which the Artist confirmed approval via the Platform's authenticated authorisation mechanism.</td></tr>
    <tr><td>"Licensed Material"</td><td>means the scan package identified in Schedule 1, comprising all files delivered pursuant to this Agreement, including but not limited to mesh files, texture assets, and metadata files.</td></tr>
    <tr><td>"Licence Period"</td><td>means the period from ${fmtDate(lic.validFrom)} to ${fmtDate(lic.validTo)} (inclusive).</td></tr>
    <tr><td>"Permitted Use"</td><td>means the specific use described in Clause 3 and Schedule 2 of this Agreement, being a ${licenceTypeLabel} licence.</td></tr>
    <tr><td>"Picture"</td><td>means the production identified as <strong>"${lic.projectName}"</strong> by ${lic.productionCompany}, as further described in Schedule 2.</td></tr>
    <tr><td>"Platform"</td><td>means the Changling Image Vault platform, operated by Changling Ltd., through which the Licensed Material is accessed and this Agreement is administered.</td></tr>
    <tr><td>"Platform Operator"</td><td>means Changling Ltd., acting as an intermediary and platform service provider and not as a party to the Permitted Use.</td></tr>
    <tr><td>"Platform Fee"</td><td>means the service fee payable to the Platform Operator, being ${fmtGBP(platformFee)} (representing 15% of the Agreed Fee).</td></tr>
    <tr><td>"Producer"</td><td>means the party licensed to use the Biometric Data under this Agreement, being <strong>${lic.productionCompany}</strong>.</td></tr>
    <tr><td>"Agreed Fee"</td><td>means the total licence fee of ${fmtGBP(agreedFee)}, of which ${fmtGBP(talentFee)} is payable to the Artist and ${fmtGBP(platformFee)} is payable to the Platform Operator as the Platform Fee.</td></tr>
    <tr><td>"Intellectual Property Rights"</td><td>means all patents, copyrights, database rights, trade marks, design rights, rights in confidential information, and all other intellectual property rights whether registered or unregistered, worldwide.</td></tr>
    <tr><td>"Personal Data"</td><td>has the meaning given in the UK General Data Protection Regulation (UK GDPR) as retained in UK domestic law by the European Union (Withdrawal) Act 2018.</td></tr>
    <tr><td>"Moral Rights"</td><td>means the right of the Artist to be identified as the subject of the Licensed Material and the right to object to derogatory treatment thereof, as provided by Chapter IV of the Copyright, Designs and Patents Act 1988.</td></tr>
    <tr><td>"Synthetic Media"</td><td>means any digitally generated or manipulated audio-visual content that uses, incorporates, or is derived from the Licensed Material, including but not limited to deepfakes, neural radiance fields (NeRF), generative AI outputs, and digital doubles.</td></tr>
    <tr><td>"Territory"</td><td>means ${lic.territory ?? "Worldwide"}.</td></tr>
  </table>
</div>

<!-- ══════════════════════════════════════════════════════════ -->
<!--  2. GRANT OF LICENCE                                      -->
<!-- ══════════════════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title"><span class="section-number">2.</span>Grant of Licence</div>
  <div class="clause"><span class="clause-num">2.1</span><span class="clause-body">Subject to the terms and conditions of this Agreement and the receipt of the Agreed Fee, the Artist grants the Producer a restricted, <strong>${exclusivityLabel.toLowerCase()}</strong>, <strong>non-sublicensable</strong>, <strong>non-transferable</strong> licence to utilise the Biometric Data exclusively for ${permittedUsePhrase} directly associated with the specific Picture outlined in this Agreement, within the Territory during the Licence Period.</span></div>
  <div class="clause"><span class="clause-num">2.2</span><span class="clause-body">The licence granted under Clause 2.1 is limited to the specific Permitted Use described in Schedule 2. Any use of the Biometric Data for sequels, derivative works, or purposes beyond the Permitted Use requires a separate, expressly negotiated licence addendum (see Clause 9.2).</span></div>
  <div class="clause"><span class="clause-num">2.3</span><span class="clause-body">${lic.exclusivity === "exclusive" ? "During the Licence Period, the Artist undertakes not to grant any equivalent rights in the Licensed Material to any third party for the same Permitted Use within the Territory." : lic.exclusivity === "sole" ? "The Artist may continue to exploit the Licensed Material for their own purposes but shall not grant equivalent rights to any third party for the same Permitted Use within the Territory during the Licence Period." : "This licence is non-exclusive and the Artist retains the right to grant equivalent licences to third parties for the same or similar uses."}</span></div>
  <div class="clause"><span class="clause-num">2.4</span><span class="clause-body">The licence is granted for use within the Territory only. The Producer shall not distribute, broadcast, or make available any content incorporating the Licensed Material outside the Territory without the prior written consent of the Artist.</span></div>
  <div class="clause"><span class="clause-num">2.5</span><span class="clause-body">This Agreement does not constitute a transfer of ownership of the Biometric Data or any Intellectual Property Rights therein. All Biometric Data shall remain the sole and exclusive property of the Artist (Clause 9.1). All rights not expressly granted are reserved by the Artist.</span></div>
</div>

<!-- ══════════════════════════════════════════════════════════ -->
<!--  3. PERMITTED USE                                         -->
<!-- ══════════════════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title"><span class="section-number">3.</span>Permitted Use</div>
  <div class="clause"><span class="clause-num">3.1</span><span class="clause-body">The Biometric Data may be used solely in connection with the Picture, being a <strong>${licenceTypeLabel}</strong> production.</span></div>
  <div class="clause"><span class="clause-num">3.2</span><span class="clause-body">The specific intended application, as described by the Producer at the time of requesting this licence, is set out in Schedule 2 of this Agreement.</span></div>
  <div class="clause"><span class="clause-num">3.3</span><span class="clause-body">The Producer acknowledges that the Licensed Material constitutes Biometric Data and Special Category Personal Data under UK GDPR and agrees to process it solely for the Permitted Use and in compliance with all applicable data protection legislation.</span></div>
  ${lic.permitAiTraining ? `
  <div class="notice warning">
    <strong>AI Processing Addendum:</strong> The Artist has expressly negotiated and consented to the use of the
    Biometric Data for artificial intelligence processing, including machine learning model training, subject to
    the restrictions set out in Clause 4.4. This addendum constitutes the separate, expressly negotiated licence
    referred to in Clause 9.2 with respect to AI training sets. This consent is specific to this Agreement and
    does not constitute a general or open-ended consent to AI processing. The Producer must ensure all AI
    processing complies with applicable data protection law, including the requirement for a lawful basis under
    UK GDPR Article 9 for processing special category biometric data.
  </div>` : `
  <div class="notice">
    <strong>AI Processing Restriction:</strong> The Artist has <strong>NOT</strong> granted permission for the
    use of the Biometric Data in connection with any form of artificial intelligence processing,
    including but not limited to machine learning model training, neural network training, synthetic media
    generation, or any automated process that extracts, analyses, or encodes biometric feature vectors. Any such
    use requires a separate, expressly negotiated licence addendum as contemplated by Clause 9.2 and will, absent
    such addendum, constitute a material breach of this Agreement.
  </div>`}
</div>

<!-- ══════════════════════════════════════════════════════════ -->
<!--  4. RESTRICTIONS                                          -->
<!-- ══════════════════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title"><span class="section-number">4.</span>Restrictions</div>
  <p>The Producer shall not, and shall procure that its employees, agents, and sub-contractors shall not:</p>
  <div class="clause"><span class="clause-num">4.1</span><span class="clause-body">Use the Licensed Material for any purpose other than the Permitted Use without the prior written consent of the Artist;</span></div>
  <div class="clause"><span class="clause-num">4.2</span><span class="clause-body">Sublicence, sell, rent, transfer, assign, or otherwise dispose of the Licensed Material or any rights therein to any third party;</span></div>
  <div class="clause"><span class="clause-num">4.3</span><span class="clause-body">Use the Licensed Material in any manner that is defamatory, obscene, unlawful, or that could damage the reputation of the Artist;</span></div>
  <div class="clause"><span class="clause-num">4.4</span><span class="clause-body">${lic.permitAiTraining ? "Use the Biometric Data to train, fine-tune, or evaluate any artificial intelligence model beyond the specific application described in the AI Processing Addendum (Clause 3) and Schedule 2, or make such trained models commercially available to third parties without a separate, expressly negotiated licence addendum (Clause 9.2);" : "Use the Biometric Data for any form of machine learning, artificial intelligence training, neural network development, synthetic media generation, deepfake creation, or any automated process that extracts, analyses, or encodes biometric feature vectors, unless a separate, expressly negotiated licence addendum has been executed pursuant to Clause 9.2;"}</span></div>
  <div class="clause"><span class="clause-num">4.5</span><span class="clause-body">Use the Licensed Material outside the Territory or beyond the Licence Period;</span></div>
  <div class="clause"><span class="clause-num">4.6</span><span class="clause-body">Modify, adapt, translate, or create derivative works of the Licensed Material except as expressly required for the Permitted Use;</span></div>
  <div class="clause"><span class="clause-num">4.7</span><span class="clause-body">Remove, obscure, or alter any copyright notices, watermarks, or other proprietary markings on or in the Licensed Material;</span></div>
  <div class="clause"><span class="clause-num">4.8</span><span class="clause-body">Store the Licensed Material on any publicly accessible server or make it available for download by any person who is not directly involved in the Permitted Use;</span></div>
  <div class="clause"><span class="clause-num">4.9</span><span class="clause-body">Use the Licensed Material in a manner that infringes the Artist's Moral Rights, including uses that are derogatory, misleading as to the Artist's opinions or beliefs, or that place the Artist in a false light.</span></div>
</div>

<!-- ══════════════════════════════════════════════════════════ -->
<!--  5. BIOMETRIC DATA & DATA PROTECTION                      -->
<!-- ══════════════════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title"><span class="section-number">5.</span>Biometric Data &amp; Data Protection</div>
  <div class="clause"><span class="clause-num">5.1</span><span class="clause-body">The Producer acknowledges that the Licensed Material constitutes Biometric Data and Special Category Personal Data within the meaning of UK GDPR Article 9 and the Data Protection Act 2018, and agrees to process it lawfully, fairly, and transparently.</span></div>
  <div class="clause"><span class="clause-num">5.2</span><span class="clause-body">The Producer shall act as an independent Data Controller in respect of its processing of the Licensed Material and shall comply with all applicable data protection legislation, including but not limited to UK GDPR, the Data Protection Act 2018, and any applicable sector-specific biometric data regulations.</span></div>
  <div class="clause"><span class="clause-num">5.3</span><span class="clause-body">The Producer shall implement and maintain appropriate technical and organisational security measures to protect the Licensed Material against unauthorised access, loss, destruction, or alteration, including but not limited to encryption at rest and in transit, access controls restricted to those directly involved in the Permitted Use, and audit logging of all access to the Licensed Material.</span></div>
  <div class="clause"><span class="clause-num">5.4</span><span class="clause-body">Upon expiry or termination of this Agreement, or upon the written request of the Artist at any time, the Producer shall: (a) facilitate the secure transfer of the master files of all Biometric Data to the Artist's designated encrypted storage provider (the "ImageVault") in accordance with Clause 9.3; (b) ensure that all copies of the raw Biometric Data in its possession or under its control, including those held by third-party VFX vendors, are securely purged, retaining only the final rendered assets necessary for the Picture's distribution; and (c) provide written certification of such actions within fourteen (14) days of the request.</span></div>
  <div class="clause"><span class="clause-num">5.5</span><span class="clause-body">The Producer shall not transfer or disclose the Licensed Material to any party located outside the United Kingdom or European Economic Area without the prior written consent of the Artist and without ensuring that equivalent protections apply to the transfer.</span></div>
  <div class="clause"><span class="clause-num">5.6</span><span class="clause-body">The Producer shall notify the Artist and the Platform Operator without undue delay (and in any event within 72 hours) of becoming aware of any actual or suspected breach of security relating to the Licensed Material.</span></div>
  <div class="clause"><span class="clause-num">5.7</span><span class="clause-body">The Artist retains the right to exercise their rights as a Data Subject under UK GDPR at any time, including the right to erasure (Article 17), subject to the legitimate interests of the Producer in completing the Permitted Use during the Licence Period.</span></div>
</div>

<!-- ══════════════════════════════════════════════════════════ -->
<!--  6. LICENSED MATERIAL                                     -->
<!-- ══════════════════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title"><span class="section-number">6.</span>Licensed Material</div>
  <div class="clause"><span class="clause-num">6.1</span><span class="clause-body">The Licensed Material comprises the scan package described in Schedule 1, made available through the Platform's secure delivery infrastructure following completion of the dual-custody verification protocol.</span></div>
  <div class="clause"><span class="clause-num">6.2</span><span class="clause-body">Delivery of the Licensed Material is effected solely via the Platform. The Artist gives no warranty that the Licensed Material will be compatible with any particular software, hardware, or production pipeline, and the Producer accepts the Licensed Material in the condition in which it is delivered.</span></div>
  <div class="clause"><span class="clause-num">6.3</span><span class="clause-body">The Platform's audit log constitutes the definitive record of when the Licensed Material was accessed and downloaded. Both parties agree that the Platform's download event records shall be admissible as evidence of delivery and access.</span></div>
  <div class="clause"><span class="clause-num">6.4</span><span class="clause-body">The Artist warrants that they have full right, power, and authority to enter into this Agreement and to grant the licence herein, and that the Licensed Material does not infringe the Intellectual Property Rights of any third party.</span></div>
</div>

<!-- ══════════════════════════════════════════════════════════ -->
<!--  7. FEES & PAYMENT                                        -->
<!-- ══════════════════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title"><span class="section-number">7.</span>Fees &amp; Payment</div>
  <div class="clause"><span class="clause-num">7.1</span><span class="clause-body">In consideration of the rights granted under this Agreement, the Producer shall pay the Agreed Fee of <strong>${fmtGBP(agreedFee)}</strong> (exclusive of VAT) in accordance with this Clause 7.</span></div>
  <div class="clause"><span class="clause-num">7.2</span><span class="clause-body">The Agreed Fee shall be disbursed as follows: <strong>${fmtGBP(talentFee)}</strong> to the Artist and <strong>${fmtGBP(platformFee)}</strong> (representing 15% of the Agreed Fee) to the Platform Operator as the Platform Service Fee.</span></div>
  <div class="clause"><span class="clause-num">7.3</span><span class="clause-body">Payment of the Agreed Fee is due within thirty (30) days of the Effective Date unless otherwise agreed in writing by the parties. All payments shall be made in US dollars (USD) unless otherwise agreed.</span></div>
  <div class="clause"><span class="clause-num">7.4</span><span class="clause-body">All sums payable under this Agreement are exclusive of Value Added Tax (VAT). Where VAT is applicable, it shall be charged in addition at the prevailing rate and shall be payable by the Producer upon receipt of a valid VAT invoice.</span></div>
  <div class="clause"><span class="clause-num">7.5</span><span class="clause-body">In the event of late payment, interest shall accrue on the outstanding amount at the rate of 8% per annum above the Bank of England base rate in accordance with the Late Payment of Commercial Debts (Interest) Act 1998.</span></div>
  <div class="clause"><span class="clause-num">7.6</span><span class="clause-body">The Producer shall not withhold, set off, or deduct any amount from the fees payable under this Agreement except as required by law.</span></div>
</div>

<!-- ══════════════════════════════════════════════════════════ -->
<!--  8. INTELLECTUAL PROPERTY                                 -->
<!-- ══════════════════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title"><span class="section-number">8.</span>Intellectual Property Rights</div>
  <div class="clause"><span class="clause-num">8.1</span><span class="clause-body">The Artist asserts their Moral Rights in respect of the Licensed Material. The Producer shall, where technically feasible, credit the Artist in any productions incorporating the Licensed Material as: "<em>${talentName}</em> (biometric likeness provided via Changling Image Vault)".</span></div>
  <div class="clause"><span class="clause-num">8.2</span><span class="clause-body">If the Producer becomes aware of any actual or threatened infringement of the Artist's Intellectual Property Rights in the Licensed Material, it shall notify the Artist promptly. The Artist shall have sole control over any enforcement action.</span></div>
  <div class="clause"><span class="clause-num">8.3</span><span class="clause-body">For the avoidance of doubt, ownership of all Biometric Data and the rights of the Artist and Producer in respect of derivative works and studio IP are governed by Clause 9.</span></div>
</div>

<!-- ══════════════════════════════════════════════════════════ -->
<!--  9. BIOMETRIC DATA OWNERSHIP & PRODUCTION USE             -->
<!-- ══════════════════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title"><span class="section-number">9.</span>Biometric Data Ownership &amp; Production Use</div>
  <div class="clause"><span class="clause-num">9.1</span><span class="clause-body"><strong>Ownership of Raw Biometric Data.</strong> All raw, untextured digital capture data relating to the Artist's physical likeness — including but not limited to 3D body scans, photogrammetry, voice samples, and Facial Action Coding System (FACS) data captured during the course of this Production (collectively, "Biometric Data") — shall remain the sole and exclusive property of the Artist.</span></div>
  <div class="clause"><span class="clause-num">9.2</span><span class="clause-body"><strong>Limited Licence for Production.</strong> Artist grants Producer a restricted, non-transferable licence to utilise the Biometric Data exclusively for the creation of visual effects and promotional materials directly associated with the specific Picture outlined in this Agreement. Any use of the Biometric Data for sequels, derivative works, video games, or AI training sets requires a separate, expressly negotiated licence.</span></div>
  <div class="clause"><span class="clause-num">9.3</span><span class="clause-body"><strong>Data Governance &amp; The ImageVault.</strong> Upon the completion of principal photography (or at the conclusion of the VFX vendor's contractual requirement), Producer agrees to facilitate the secure transfer of the master files of all Biometric Data to the Artist's designated encrypted storage provider ("ImageVault"). Following this transfer and the completion of the Picture, Producer shall ensure that all third-party VFX vendors purge the raw Biometric Data from their active servers, retaining only the final rendered assets necessary for the Picture's distribution.</span></div>
  <div class="clause"><span class="clause-num">9.4</span><span class="clause-body"><strong>Exclusions — Protection of Studio IP.</strong> It is expressly understood that this clause applies solely to the Artist's underlying physical and biometric identity. Producer retains full and exclusive ownership of all proprietary character designs, wardrobe, prosthetics, and final rendered, composited visual effects shots created for the Picture.</span></div>
</div>

<!-- ══════════════════════════════════════════════════════════ -->
<!--  10. AUDIT RIGHTS                                         -->
<!-- ══════════════════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title"><span class="section-number">10.</span>Audit Rights</div>
  <div class="clause"><span class="clause-num">10.1</span><span class="clause-body">The Artist shall have the right, upon giving not less than five (5) business days' written notice to the Producer, to audit the Producer's use of the Licensed Material to verify compliance with the terms of this Agreement, no more than once per twelve-month period.</span></div>
  <div class="clause"><span class="clause-num">10.2</span><span class="clause-body">The Artist may request from the Platform Operator, at any time during the Licence Period or for two (2) years thereafter, a full export of all download events, access logs, and chain-of-custody records relating to the Licensed Material. The Platform Operator shall provide such records within five (5) business days of request.</span></div>
  <div class="clause"><span class="clause-num">10.3</span><span class="clause-body">The Producer shall maintain complete and accurate records of its use of the Licensed Material and shall make such records available to the Artist upon request.</span></div>
  <div class="clause"><span class="clause-num">10.4</span><span class="clause-body">If any audit reveals that the Producer has used the Licensed Material in breach of this Agreement, the Producer shall: (a) immediately cease such use; (b) pay the costs of the audit; and (c) pay additional licence fees or damages as determined by the parties or, failing agreement, by a court of competent jurisdiction.</span></div>
</div>

<!-- ══════════════════════════════════════════════════════════ -->
<!--  11. REVOCATION & TERMINATION                             -->
<!-- ══════════════════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title"><span class="section-number">11.</span>Revocation &amp; Termination</div>
  <div class="clause"><span class="clause-num">11.1</span><span class="clause-body">This Agreement shall automatically terminate upon expiry of the Licence Period unless renewed in writing by the parties.</span></div>
  <div class="clause"><span class="clause-num">11.2</span><span class="clause-body">The Artist may terminate this Agreement with immediate effect by written notice to the Producer if:</span></div>
  <div class="sub-clause"><span class="clause-num">11.2.1</span><span class="clause-body">the Producer commits a material breach of any term of this Agreement and (if such breach is remediable) fails to remedy such breach within fourteen (14) days of being notified in writing;</span></div>
  <div class="sub-clause"><span class="clause-num">11.2.2</span><span class="clause-body">the Producer uses the Licensed Material for any purpose not expressly authorised by this Agreement, including any prohibited AI processing;</span></div>
  <div class="sub-clause"><span class="clause-num">11.2.3</span><span class="clause-body">the Producer becomes insolvent, enters administration, or is subject to a winding-up order;</span></div>
  <div class="sub-clause"><span class="clause-num">11.2.4</span><span class="clause-body">there is a change of control of the Producer without the prior written consent of the Artist.</span></div>
  <div class="clause"><span class="clause-num">11.3</span><span class="clause-body">The Platform Operator reserves the right to suspend or revoke access to the Licensed Material on the Platform in the event of a suspected security breach, regulatory requirement, or court order, without liability to either party.</span></div>
  <div class="clause"><span class="clause-num">11.4</span><span class="clause-body">Upon termination or expiry, the Producer shall immediately: (a) cease all use of the Licensed Material; (b) delete or destroy all copies in its possession or control; (c) confirm such deletion in writing to the Artist within seven (7) days; and (d) pay all outstanding sums due under this Agreement.</span></div>
  <div class="clause"><span class="clause-num">11.5</span><span class="clause-body">Termination of this Agreement shall not affect any rights or remedies of either party that have accrued prior to termination. Clauses 1, 4, 5.4, 8, 9, 10, 11.4, 12, 13 and 14 shall survive termination.</span></div>
</div>

<!-- ══════════════════════════════════════════════════════════ -->
<!--  12. LIABILITY & INDEMNITY                                -->
<!-- ══════════════════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title"><span class="section-number">12.</span>Liability &amp; Indemnity</div>
  <div class="clause"><span class="clause-num">12.1</span><span class="clause-body">The Producer shall indemnify, defend, and hold harmless the Artist and the Platform Operator against all losses, damages, costs (including reasonable legal fees), claims, and liabilities arising from: (a) the Producer's use of the Licensed Material in breach of this Agreement; (b) any infringement by the Producer of third-party rights; (c) any data protection breach by the Producer in respect of the Licensed Material; or (d) any misrepresentation made by the Producer in the licence request.</span></div>
  <div class="clause"><span class="clause-num">12.2</span><span class="clause-body">The Artist's total aggregate liability to the Producer under or in connection with this Agreement shall not exceed the Agreed Fee paid under this Agreement.</span></div>
  <div class="clause"><span class="clause-num">12.3</span><span class="clause-body">Neither party shall be liable for: (a) any indirect, special, or consequential losses; (b) loss of profits or revenue; (c) loss of anticipated savings; or (d) loss of goodwill, in each case whether or not such losses were foreseeable or the party had been advised of their possibility.</span></div>
  <div class="clause"><span class="clause-num">12.4</span><span class="clause-body">Nothing in this Agreement limits or excludes liability for death or personal injury caused by negligence, fraud or fraudulent misrepresentation, or any other matter that cannot be excluded by law.</span></div>
</div>

<!-- ══════════════════════════════════════════════════════════ -->
<!--  13. GOVERNING LAW                                        -->
<!-- ══════════════════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title"><span class="section-number">13.</span>Governing Law &amp; Dispute Resolution</div>
  <div class="clause"><span class="clause-num">13.1</span><span class="clause-body">This Agreement and any dispute or claim arising out of or in connection with it or its subject matter or formation (including non-contractual disputes or claims) shall be governed by and construed in accordance with the law of England and Wales.</span></div>
  <div class="clause"><span class="clause-num">13.2</span><span class="clause-body">The parties irrevocably agree that the courts of England and Wales shall have exclusive jurisdiction to settle any dispute or claim arising out of or in connection with this Agreement.</span></div>
  <div class="clause"><span class="clause-num">13.3</span><span class="clause-body">Before commencing any formal proceedings, the parties agree to attempt to resolve any dispute through good-faith negotiations for a period of not less than thirty (30) days following written notice from one party to the other identifying the dispute.</span></div>
</div>

<!-- ══════════════════════════════════════════════════════════ -->
<!--  14. GENERAL                                              -->
<!-- ══════════════════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title"><span class="section-number">14.</span>General Provisions</div>
  <div class="clause"><span class="clause-num">14.1</span><span class="clause-body"><strong>Entire Agreement.</strong> This Agreement constitutes the entire agreement between the parties relating to its subject matter and supersedes all prior representations, agreements, negotiations, and understandings, whether oral or written.</span></div>
  <div class="clause"><span class="clause-num">14.2</span><span class="clause-body"><strong>Variation.</strong> No amendment or variation of this Agreement shall be effective unless made in writing and signed by authorised representatives of both parties.</span></div>
  <div class="clause"><span class="clause-num">14.3</span><span class="clause-body"><strong>Waiver.</strong> No failure or delay by a party to exercise any right or remedy provided under this Agreement shall constitute a waiver of that or any other right or remedy.</span></div>
  <div class="clause"><span class="clause-num">14.4</span><span class="clause-body"><strong>Severability.</strong> If any provision of this Agreement is found invalid or unenforceable, that provision shall be modified to the minimum extent necessary to make it enforceable, and the remaining provisions shall continue in full force.</span></div>
  <div class="clause"><span class="clause-num">14.5</span><span class="clause-body"><strong>Third Parties.</strong> Except for the Platform Operator in respect of the Platform Fee and audit provisions, no term of this Agreement is intended to confer a benefit on, or be enforceable by, any person who is not a party to this Agreement under the Contracts (Rights of Third Parties) Act 1999.</span></div>
  <div class="clause"><span class="clause-num">14.6</span><span class="clause-body"><strong>Notices.</strong> All notices under this Agreement shall be in writing and delivered via the Platform's secure messaging system or to the email addresses of the parties as registered on the Platform.</span></div>
  <div class="clause"><span class="clause-num">14.7</span><span class="clause-body"><strong>Force Majeure.</strong> Neither party shall be liable for any failure or delay in performance resulting from circumstances beyond their reasonable control, including natural disasters, pandemic, war, or government action, provided that the affected party gives prompt written notice and uses reasonable endeavours to resume performance.</span></div>
  <div class="clause"><span class="clause-num">14.8</span><span class="clause-body"><strong>Platform Authentication Record.</strong> The parties acknowledge and agree that the Artist's authenticated approval of this licence via the Platform's dual-custody mechanism (using time-based one-time password verification) constitutes a valid and binding acceptance of these terms and is equivalent in effect to a handwritten signature for the purposes of the Electronic Communications Act 2000.</span></div>
</div>

<!-- ══════════════════════════════════════════════════════════ -->
<!--  SCHEDULE 1 — LICENSED MATERIAL                          -->
<!-- ══════════════════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title"><span class="section-number">Sch. 1</span>Licensed Material</div>
  <table class="data-table">
    <tr><th>Field</th><th>Detail</th></tr>
    <tr><td>Package Name</td><td>${pkg?.name ?? "—"}</td></tr>
    <tr><td>Scan Studio</td><td>${pkg?.studioName ?? "—"}</td></tr>
    <tr><td>Capture Date</td><td>${fmtDate(pkg?.captureDate ?? null)}</td></tr>
    <tr><td>File Count</td><td>${fileCountNum} file${fileCountNum !== 1 ? "s" : ""} (completed uploads)</td></tr>
    <tr><td>Archive Format</td><td>Delivered as individual files via Changling Image Vault secure download. A ZIP archive is available for all files.</td></tr>
    <tr><td>Platform Reference</td><td>Package ID: ${lic.packageId}</td></tr>
    <tr><td>Technician Notes</td><td>${pkg?.technicianNotes ?? "None recorded"}</td></tr>
  </table>
</div>

<!-- ══════════════════════════════════════════════════════════ -->
<!--  SCHEDULE 2 — PERMITTED USE                              -->
<!-- ══════════════════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title"><span class="section-number">Sch. 2</span>Permitted Use &amp; Commercial Terms</div>
  <table class="data-table">
    <tr><th>Term</th><th>Detail</th></tr>
    <tr><td>Licence Type</td><td>${licenceTypeLabel}</td></tr>
    <tr><td>Project Name</td><td>${lic.projectName}</td></tr>
    <tr><td>Production Company</td><td>${lic.productionCompany}</td></tr>
    <tr><td>Intended Use</td><td style="white-space:pre-line">${lic.intendedUse}</td></tr>
    <tr><td>Territory</td><td>${lic.territory ?? "Worldwide"}</td></tr>
    <tr><td>Exclusivity</td><td>${exclusivityLabel}</td></tr>
    <tr><td>Licence Start</td><td>${fmtDate(lic.validFrom)}</td></tr>
    <tr><td>Licence End</td><td>${fmtDate(lic.validTo)}</td></tr>
    <tr><td>AI Processing</td><td>${lic.permitAiTraining ? "Permitted (see Clause 3 and 4.4)" : "Not permitted"}</td></tr>
    <tr><td>Agreed Fee</td><td>${fmtGBP(agreedFee)}</td></tr>
    <tr><td>Platform Fee (15%)</td><td>${fmtGBP(platformFee)}</td></tr>
    <tr><td>Talent Receives</td><td>${fmtGBP(talentFee)}</td></tr>
  </table>
</div>

<!-- ══════════════════════════════════════════════════════════ -->
<!--  EXECUTION                                                -->
<!-- ══════════════════════════════════════════════════════════ -->
<div class="section">
  <div class="section-title"><span class="section-number">—</span>Execution</div>

  <p style="margin-bottom:24px">
    This Agreement has been entered into on the date first written above. The parties acknowledge that
    the Artist's authenticated approval of this licence via the Platform's two-factor authorisation
    mechanism constitutes binding acceptance of these terms.
  </p>

  <div class="sig-grid">
    <div class="sig-block">
      <div class="sig-party">Signed for and on behalf of<br>the Artist</div>
      <div class="sig-line"></div>
      <div class="sig-label">Signature</div>
      <div class="sig-line"></div>
      <div class="sig-label">Full name: ${talentName}</div>
      <div class="sig-line"></div>
      <div class="sig-label">Date</div>
      <div style="margin-top:12px;font-size:8.5pt;color:var(--muted)">
        Platform authentication completed: ${fmtDate(lic.approvedAt)}<br>
        Authenticated via: TOTP two-factor verification<br>
        Platform record: ${ref}
      </div>
    </div>
    <div class="sig-block">
      <div class="sig-party">Signed for and on behalf of<br>the Producer</div>
      <div class="sig-line"></div>
      <div class="sig-label">Signature</div>
      <div class="sig-line"></div>
      <div class="sig-label">Full name</div>
      <div class="sig-line"></div>
      <div class="sig-label">Title / Position</div>
      <div class="sig-line"></div>
      <div class="sig-label">Date</div>
      <div style="margin-top:12px;font-size:8.5pt;color:var(--muted)">
        Organisation: ${lic.productionCompany}<br>
        Email: ${licenseeUser?.email ?? "—"}
      </div>
    </div>
  </div>

  <p style="margin-top:40px;font-size:8pt;color:var(--muted);text-align:center;line-height:1.6">
    This document was generated by Changling Image Vault · Contract reference: ${ref} · Generated: ${today}<br>
    For queries regarding this agreement contact the Platform Operator via the Image Vault platform.
  </p>
</div>

</div><!-- /content -->
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}

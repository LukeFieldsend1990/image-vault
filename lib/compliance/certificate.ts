// Compliance Certificate generation + verification (SPEC §16.12) — the hero.
//
// Walks the regime's obligations against the licence chain(s), folds in existing
// audit trails (usage_events, download_events), renders a self-contained printable
// HTML doc to R2, and seals it with the ledger tip hash. verify() recomputes the
// chain and compares — a mismatch means the ledger was altered after issuance.

import { eq, inArray } from "drizzle-orm";
import { canonicalJson, sha256Hex, verifyChain, licenceChain } from "./ledger";
import { evaluateObligations } from "./registry";
import "./regimes"; // ensure regimes are registered
import {
  complianceCertificates,
  complianceEvents,
  downloadEvents,
  licences,
  organisations,
  productions,
  scrubAttestations,
  talentProfiles,
  usageEvents,
  users,
} from "@/lib/db/schema";
import type { getDb } from "@/lib/db";
import type { HashedEvent, EvaluatedEvent, ObligationResult, RegimeId } from "./types";

type Db = ReturnType<typeof getDb>;

export interface CertBucket {
  put(key: string, value: string, opts?: unknown): Promise<unknown>;
}

export type CertScope = "licence" | "talent" | "production" | "organisation";

interface LedgerRow extends HashedEvent {
  scope: EvaluatedEvent["scope"];
  clauseRef: string | null;
  createdAt: number;
}

// ── Pure ledger verification ────────────────────────────────────────────────

export interface LedgerVerification {
  ok: boolean;
  tipHash: string;
  brokenAtSeq?: number;
}

// Verify one chain's integrity and return its tip hash. Pure (no DB).
export async function verifyLedgerEvents(events: HashedEvent[]): Promise<LedgerVerification> {
  if (events.length === 0) return { ok: true, tipHash: "" };
  const result = await verifyChain(events);
  const tipHash = events[events.length - 1].hash;
  if (!result.ok) return { ok: false, tipHash, brokenAtSeq: result.brokenAtSeq };
  return { ok: true, tipHash };
}

// Combine per-chain tip hashes into one scope seal, stable regardless of order.
export async function computeScopeTip(perLicence: Array<{ licenceId: string; tip: string }>): Promise<string> {
  const sorted = [...perLicence].sort((a, b) => a.licenceId.localeCompare(b.licenceId));
  return sha256Hex(canonicalJson(sorted));
}

// ── DB loaders ──────────────────────────────────────────────────────────────

async function resolveLicenceIds(db: Db, scope: CertScope, scopeId: string): Promise<string[]> {
  if (scope === "licence") return [scopeId];
  const col =
    scope === "talent"       ? licences.talentId :
    scope === "organisation" ? licences.organisationId :
                               licences.productionId;
  const rows = await db.select({ id: licences.id }).from(licences).where(eq(col, scopeId)).all();
  return rows.map((r) => r.id);
}

async function loadChainEvents(db: Db, licenceId: string): Promise<LedgerRow[]> {
  const rows = await db
    .select()
    .from(complianceEvents)
    .where(eq(complianceEvents.chainKey, licenceChain(licenceId)))
    .orderBy(complianceEvents.seq)
    .all();
  return rows.map((r) => ({
    chainKey: r.chainKey,
    seq: r.seq,
    eventType: r.eventType,
    payload: safeParse(r.payloadJson),
    prevHash: r.prevHash,
    hash: r.hash,
    scope: safeParse(r.scopeJson) as EvaluatedEvent["scope"],
    clauseRef: r.clauseRef,
    createdAt: r.createdAt,
  }));
}

// ── Generation ──────────────────────────────────────────────────────────────

export interface GenerateResult {
  id: string;
  url: string;
  ledgerTipHash: string;
  obligations: ObligationResult[];
  eventCount: number;
}

// Load + evaluate a scope's obligations without rendering — powers the status
// endpoint and the admin obligation matrix, and is reused by generateCertificate.
export interface ScopeEvaluation {
  obligations: ObligationResult[];
  events: LedgerRow[];
  perLicence: Array<{ licenceId: string; tip: string }>;
  licenceIds: string[];
}

export async function evaluateScope(
  db: Db,
  scope: CertScope,
  scopeId: string,
  regime: RegimeId,
): Promise<ScopeEvaluation> {
  const licenceIds = await resolveLicenceIds(db, scope, scopeId);

  const perLicence: Array<{ licenceId: string; tip: string }> = [];
  let allEvents: LedgerRow[] = [];
  for (const lid of licenceIds) {
    const ev = await loadChainEvents(db, lid);
    allEvents = allEvents.concat(ev);
    perLicence.push({ licenceId: lid, tip: ev.length ? ev[ev.length - 1].hash : "" });
  }

  const meta = await loadLicenceMeta(db, licenceIds);
  const repLicence = {
    licenceType: meta.anyAi ? "ai_avatar" : (meta.firstType ?? "commercial"),
    permitAiTraining: meta.anyPermit,
  };

  const evaluated: EvaluatedEvent[] = allEvents.map((e) => ({ eventType: e.eventType, scope: e.scope }));
  const obligations = evaluateObligations(regime, repLicence, evaluated);

  return { obligations, events: allEvents, perLicence, licenceIds };
}

export async function generateCertificate(
  db: Db,
  bucket: CertBucket,
  p: { scope: CertScope; scopeId: string; regime?: RegimeId; generatedBy: string },
): Promise<GenerateResult> {
  const regime: RegimeId = p.regime ?? "sag_aftra";
  const { obligations, events: allEvents, perLicence, licenceIds } = await evaluateScope(
    db,
    p.scope,
    p.scopeId,
    regime,
  );

  const usage = await loadUsageSummary(db, licenceIds);
  const downloads = await loadDownloadCount(db, licenceIds);
  const profile =
    p.scope === "talent"       ? await loadTalentName(db, p.scopeId) :
    p.scope === "organisation" ? await loadOrgName(db, p.scopeId) :
                                 null;

  // Build production/licence breakdown for multi-licence scopes
  const breakdown = licenceIds.length > 1
    ? await buildProductionBreakdown(db, licenceIds, regime)
    : null;

  const ledgerTipHash = await computeScopeTip(perLicence);

  const id = crypto.randomUUID();
  const generatedAt = Math.floor(Date.now() / 1000);
  const html = renderCertificateHtml({
    id,
    scope: p.scope,
    scopeId: p.scopeId,
    regime,
    generatedAt,
    ledgerTipHash,
    obligations,
    events: allEvents,
    usage,
    downloads,
    talentName: profile,
    licenceCount: licenceIds.length,
    breakdown,
  });

  const r2Key = `compliance-certs/${id}.html`;
  await bucket.put(r2Key, html, { httpMetadata: { contentType: "text/html; charset=utf-8" } });

  await db.insert(complianceCertificates).values({
    id,
    scope: p.scope,
    scopeId: p.scopeId,
    regime,
    r2Key,
    ledgerTipHash,
    obligationsJson: JSON.stringify(obligations),
    eventCount: allEvents.length,
    generatedBy: p.generatedBy,
    generatedAt,
  });

  return { id, url: `/api/compliance/certificates/${id}`, ledgerTipHash, obligations, eventCount: allEvents.length };
}

// ── Verification (DB-backed) ────────────────────────────────────────────────

export interface CertVerifyResult {
  ok: boolean;
  reason?: string;
  storedTipHash: string;
  currentTipHash: string;
}

export async function verifyCertificate(db: Db, certificateId: string): Promise<CertVerifyResult | null> {
  const cert = await db
    .select({ scope: complianceCertificates.scope, scopeId: complianceCertificates.scopeId, ledgerTipHash: complianceCertificates.ledgerTipHash })
    .from(complianceCertificates)
    .where(eq(complianceCertificates.id, certificateId))
    .get();
  if (!cert) return null;

  const licenceIds = await resolveLicenceIds(db, cert.scope as CertScope, cert.scopeId);
  const perLicence: Array<{ licenceId: string; tip: string }> = [];
  for (const lid of licenceIds) {
    const events = await loadChainEvents(db, lid);
    const chk = await verifyLedgerEvents(events);
    if (!chk.ok) {
      return { ok: false, reason: `chain ${lid} broken at seq ${chk.brokenAtSeq}`, storedTipHash: cert.ledgerTipHash, currentTipHash: "" };
    }
    perLicence.push({ licenceId: lid, tip: chk.tipHash });
  }

  const currentTipHash = await computeScopeTip(perLicence);
  const ok = currentTipHash === cert.ledgerTipHash;
  return {
    ok,
    reason: ok ? undefined : "ledger tip hash does not match the sealed certificate",
    storedTipHash: cert.ledgerTipHash,
    currentTipHash,
  };
}

// ── helpers ───────────────────────────────────────────────────────────────

// ── Per-licence / production breakdown ───────────────────────────────────────

interface LicenceDetail {
  id: string;
  projectName: string;
  productionId: string | null;
  licenceType: string | null;
  status: string;
  validFrom: number;
  validTo: number;
  talentId: string;
}

export interface ScrubAttestationRecord {
  id: string;
  attestedAt: number;
  attestedByEmail: string | null;
  attestationText: string;
  devicesScrubbed: string[];
  bridgeCachePurged: boolean;
  additionalNotes: string | null;
}

export interface LicenceBreakdown {
  detail: LicenceDetail;
  talentName: string | null;
  obligations: ObligationResult[];
  events: LedgerRow[];
  scrubAttestation: ScrubAttestationRecord | null;
}

export interface ProductionGroup {
  productionId: string | null;
  productionName: string;
  productionType: string | null;
  licences: LicenceBreakdown[];
}

async function loadLicenceDetails(db: Db, licenceIds: string[]): Promise<LicenceDetail[]> {
  if (licenceIds.length === 0) return [];
  return db
    .select({
      id: licences.id,
      projectName: licences.projectName,
      productionId: licences.productionId,
      licenceType: licences.licenceType,
      status: licences.status,
      validFrom: licences.validFrom,
      validTo: licences.validTo,
      talentId: licences.talentId,
    })
    .from(licences)
    .where(inArray(licences.id, licenceIds))
    .all();
}

async function loadTalentNames(db: Db, talentIds: string[]): Promise<Map<string, string>> {
  if (talentIds.length === 0) return new Map();
  const rows = await db
    .select({ userId: talentProfiles.userId, fullName: talentProfiles.fullName })
    .from(talentProfiles)
    .where(inArray(talentProfiles.userId, [...new Set(talentIds)]))
    .all();
  return new Map(rows.map((r) => [r.userId, r.fullName]));
}

async function loadProductionMeta(
  db: Db,
  productionIds: string[],
): Promise<Map<string, { name: string; type: string | null }>> {
  if (productionIds.length === 0) return new Map();
  const rows = await db
    .select({ id: productions.id, name: productions.name, type: productions.type })
    .from(productions)
    .where(inArray(productions.id, [...new Set(productionIds)]))
    .all();
  return new Map(rows.map((r) => [r.id, { name: r.name, type: r.type }]));
}

async function loadScrubAttestations(
  db: Db,
  licenceIds: string[],
): Promise<Map<string, ScrubAttestationRecord>> {
  if (licenceIds.length === 0) return new Map();

  const rows = await db
    .select({
      id: scrubAttestations.id,
      licenceId: scrubAttestations.licenceId,
      attestedAt: scrubAttestations.attestedAt,
      attestedBy: scrubAttestations.attestedBy,
      attestationText: scrubAttestations.attestationText,
      devicesScrubbed: scrubAttestations.devicesScrubbed,
      bridgeCachePurged: scrubAttestations.bridgeCachePurged,
      additionalNotes: scrubAttestations.additionalNotes,
    })
    .from(scrubAttestations)
    .where(inArray(scrubAttestations.licenceId, licenceIds))
    .all();

  // Load attesting users' emails in one query
  const userIds = [...new Set(rows.map((r) => r.attestedBy))];
  const userEmails =
    userIds.length > 0
      ? await db
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(inArray(users.id, userIds))
          .all()
      : [];
  const emailMap = new Map(userEmails.map((u) => [u.id, u.email]));

  const result = new Map<string, ScrubAttestationRecord>();
  for (const row of rows) {
    let devices: string[] = [];
    try { devices = JSON.parse(row.devicesScrubbed ?? "[]") as string[]; } catch { /* */ }
    result.set(row.licenceId, {
      id: row.id,
      attestedAt: row.attestedAt,
      attestedByEmail: emailMap.get(row.attestedBy) ?? null,
      attestationText: row.attestationText,
      devicesScrubbed: devices,
      bridgeCachePurged: row.bridgeCachePurged,
      additionalNotes: row.additionalNotes ?? null,
    });
  }
  return result;
}

async function buildProductionBreakdown(
  db: Db,
  licenceIds: string[],
  regime: RegimeId,
): Promise<ProductionGroup[]> {
  if (licenceIds.length === 0) return [];

  const details = await loadLicenceDetails(db, licenceIds);
  const talentNames = await loadTalentNames(db, details.map((d) => d.talentId));
  const prodIds = details.map((d) => d.productionId).filter(Boolean) as string[];
  const productionMeta = await loadProductionMeta(db, prodIds);
  const scrubMap = await loadScrubAttestations(db, licenceIds);

  // Build per-licence breakdown (events + obligations)
  const licenceBreakdowns: LicenceBreakdown[] = [];
  for (const detail of details) {
    const events = await loadChainEvents(db, detail.id);
    const repLicence = { licenceType: detail.licenceType, permitAiTraining: false };
    const evaluated = events.map((e) => ({ eventType: e.eventType, scope: e.scope }));
    const obligations = evaluateObligations(regime, repLicence, evaluated);
    licenceBreakdowns.push({
      detail,
      talentName: talentNames.get(detail.talentId) ?? null,
      obligations,
      events,
      scrubAttestation: scrubMap.get(detail.id) ?? null,
    });
  }

  // Group by production, then loose licences
  const groups = new Map<string, ProductionGroup>();
  for (const lb of licenceBreakdowns) {
    const key = lb.detail.productionId ?? `__loose__${lb.detail.projectName}`;
    if (!groups.has(key)) {
      const prod = lb.detail.productionId ? productionMeta.get(lb.detail.productionId) : null;
      groups.set(key, {
        productionId: lb.detail.productionId,
        productionName: prod?.name ?? lb.detail.projectName,
        productionType: prod?.type ?? null,
        licences: [],
      });
    }
    groups.get(key)!.licences.push(lb);
  }

  // Named productions first, then loose licences
  const named = [...groups.values()].filter((g) => g.productionId !== null);
  const loose = [...groups.values()].filter((g) => g.productionId === null);
  return [...named, ...loose];
}

async function loadLicenceMeta(db: Db, licenceIds: string[]) {
  if (licenceIds.length === 0) return { anyAi: false, anyPermit: false, firstType: null as string | null };
  const rows = await db
    .select({ licenceType: licences.licenceType, permitAiTraining: licences.permitAiTraining })
    .from(licences)
    .where(inArray(licences.id, licenceIds))
    .all();
  const AI = new Set(["ai_avatar", "training_data"]);
  return {
    anyAi: rows.some((r) => (r.licenceType && AI.has(r.licenceType)) || r.permitAiTraining),
    anyPermit: rows.some((r) => r.permitAiTraining),
    firstType: rows[0]?.licenceType ?? null,
  };
}

async function loadUsageSummary(db: Db, licenceIds: string[]) {
  if (licenceIds.length === 0) return { count: 0, grossPence: 0, talentPence: 0 };
  const rows = await db
    .select({ grossPence: usageEvents.grossPence, talentPence: usageEvents.talentPence })
    .from(usageEvents)
    .where(inArray(usageEvents.licenceId, licenceIds))
    .all();
  return {
    count: rows.length,
    grossPence: rows.reduce((s, r) => s + (r.grossPence ?? 0), 0),
    talentPence: rows.reduce((s, r) => s + (r.talentPence ?? 0), 0),
  };
}

async function loadDownloadCount(db: Db, licenceIds: string[]): Promise<number> {
  if (licenceIds.length === 0) return 0;
  const rows = await db
    .select({ id: downloadEvents.id })
    .from(downloadEvents)
    .where(inArray(downloadEvents.licenceId, licenceIds))
    .all();
  return rows.length;
}

async function loadTalentName(db: Db, talentId: string): Promise<string | null> {
  const row = await db
    .select({ fullName: talentProfiles.fullName })
    .from(talentProfiles)
    .where(eq(talentProfiles.userId, talentId))
    .get();
  return row?.fullName ?? null;
}

async function loadOrgName(db: Db, orgId: string): Promise<string | null> {
  const row = await db
    .select({ name: organisations.name })
    .from(organisations)
    .where(eq(organisations.id, orgId))
    .get();
  return row?.name ?? null;
}

function safeParse(json: string | null): Record<string, unknown> {
  if (!json) return {};
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ── HTML rendering (self-contained, printable) ──────────────────────────────

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

function statusBadge(status: string): string {
  const map: Record<string, string> = { met: "#1a7f37", gap: "#c0392b", "n/a": "#888", pending: "#2563eb" };
  const label: Record<string, string> = { met: "✓ MET", gap: "⚠ GAP", "n/a": "N/A", pending: "⏳ PENDING" };
  return `<span style="color:${map[status] ?? "#888"};font-weight:600">${label[status] ?? status}</span>`;
}

function fmtDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function renderLicenceSection(lb: LicenceBreakdown): string {
  const d = lb.detail;
  const type = d.licenceType ? d.licenceType.replace(/_/g, " ") : "—";
  const talent = lb.talentName ?? d.talentId.slice(0, 8);
  const validity = `${fmtDate(d.validFrom)} – ${fmtDate(d.validTo)}`;

  const obligationRows = lb.obligations
    .map((o) => `<tr><td>${esc(o.clauseRef)}</td><td>${esc(o.title)}</td><td>${esc(o.severity)}</td><td>${statusBadge(o.status)}</td></tr>`)
    .join("");

  const eventRows = lb.events
    .map((e) => `<tr><td>${e.seq}</td><td>${esc(e.eventType)}</td><td>${esc(e.clauseRef ?? "")}</td><td><code>${esc(e.hash.slice(0, 16))}…</code></td></tr>`)
    .join("");

  const sa = lb.scrubAttestation;
  const scrubSection = sa ? `
  <div class="scrub-block">
    <p class="sub-header">Scrub &amp; Deletion Attestation</p>
    <table style="margin-bottom:8px">
      <tr><th style="width:160px">Submitted</th><td>${esc(fmtDate(sa.attestedAt))}${sa.attestedByEmail ? ` by ${esc(sa.attestedByEmail)}` : ""}</td></tr>
      <tr><th>Devices scrubbed</th><td>${sa.devicesScrubbed.length > 0 ? sa.devicesScrubbed.map(esc).join(", ") : "—"}</td></tr>
      <tr><th>Bridge cache purged</th><td>${sa.bridgeCachePurged ? "✓ Yes" : "No"}</td></tr>
      ${sa.additionalNotes ? `<tr><th>Additional notes</th><td>${esc(sa.additionalNotes)}</td></tr>` : ""}
    </table>
    <p style="font-size:11px;color:#555;background:#fafafa;padding:8px 10px;border-left:2px solid #ddd;margin:0">${esc(sa.attestationText)}</p>
  </div>` : "";

  return `
<div class="licence-block">
  <p class="licence-title">
    Licence <code>${esc(d.id.slice(0, 8))}</code>
    <span class="licence-meta"> · ${esc(type)} · ${esc(talent)} · ${esc(d.status)} · ${esc(validity)}</span>
  </p>
  <table><thead><tr><th>Clause</th><th>Obligation</th><th>Severity</th><th>Status</th></tr></thead>
  <tbody>${obligationRows || '<tr><td colspan="4" class="muted">No obligations.</td></tr>'}</tbody></table>
  ${lb.events.length > 0 ? `
  <p class="sub-header">Ledger (${lb.events.length} event${lb.events.length !== 1 ? "s" : ""})</p>
  <table><thead><tr><th>#</th><th>Event</th><th>Clause</th><th>Hash</th></tr></thead>
  <tbody>${eventRows}</tbody></table>` : `<p class="muted" style="margin-top:6px">No ledger events.</p>`}
  ${scrubSection}
</div>`;
}

function renderBreakdownSection(breakdown: ProductionGroup[]): string {
  if (breakdown.length === 0) return "";

  const sections = breakdown.map((group) => {
    const isLoose = group.productionId === null;
    const header = isLoose
      ? `Ungrouped Licences`
      : `${esc(group.productionName)}${group.productionType ? ` <span class="licence-meta">· ${esc(group.productionType.replace(/_/g, " "))}</span>` : ""}`;
    const count = group.licences.length;
    return `
<div class="prod-group">
  <div class="prod-header">${header} <span class="licence-meta">(${count} licence${count !== 1 ? "s" : ""})</span></div>
  ${group.licences.map(renderLicenceSection).join("")}
</div>`;
  }).join("");

  return `<h2>Production Breakdown</h2>${sections}`;
}

function renderCertificateHtml(d: {
  id: string;
  scope: string;
  scopeId: string;
  regime: string;
  generatedAt: number;
  ledgerTipHash: string;
  obligations: ObligationResult[];
  events: LedgerRow[];
  usage: { count: number; grossPence: number; talentPence: number };
  downloads: number;
  talentName: string | null;
  licenceCount: number;
  breakdown: ProductionGroup[] | null;
}): string {
  const when = new Date(d.generatedAt * 1000).toISOString();
  const obligationRows = d.obligations
    .map(
      (o) =>
        `<tr><td>${esc(o.clauseRef)}</td><td>${esc(o.title)}</td><td>${esc(o.severity)}</td><td>${statusBadge(o.status)}</td></tr>`,
    )
    .join("");
  const eventRows = d.events
    .map(
      (e) =>
        `<tr><td>${e.seq}</td><td>${esc(e.eventType)}</td><td>${esc(e.clauseRef ?? "")}</td><td><code>${esc(e.hash.slice(0, 16))}…</code></td></tr>`,
    )
    .join("");
  const strikes = d.events.filter((e) => e.eventType.startsWith("strike.") || e.eventType === "use.blocked_by_strike");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<title>Compliance Certificate ${esc(d.id)}</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#222;max-width:900px;margin:40px auto;padding:0 24px;line-height:1.5}
  h1{font-size:22px;margin:0 0 4px} h2{font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:#666;margin:32px 0 10px;padding-bottom:6px;border-bottom:1px solid #e5e5e5}
  .muted{color:#777;font-size:13px} table{width:100%;border-collapse:collapse;font-size:13px;margin-top:6px}
  th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #eee} th{color:#888;font-weight:600;font-size:11px;text-transform:uppercase}
  .seal{margin-top:24px;padding:12px;border:1px solid #ddd;border-radius:6px;background:#fafafa;font-size:12px}
  code{font-family:ui-monospace,monospace;font-size:12px} .accent{color:#c0392b}
  .prod-group{margin:0 0 24px}
  .prod-header{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;padding:10px 12px;background:#f5f5f5;border-left:3px solid #c0392b;margin-bottom:0}
  .licence-block{padding:12px 12px 16px;border:1px solid #eee;border-top:none;margin-bottom:8px}
  .licence-title{font-size:12px;font-weight:600;margin:0 0 8px;color:#333}
  .licence-meta{font-weight:400;color:#777}
  .sub-header{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#999;margin:12px 0 4px}
  .scrub-block{margin-top:12px;padding:10px 12px;background:#f9f9f9;border:1px solid #e0e0e0;border-radius:4px}
</style></head><body>
<h1>SAG-AFTRA Compliance Certificate</h1>
<p class="muted">${esc(d.regime)} · ${esc(d.scope)} ${esc(d.talentName ?? d.scopeId)}${d.licenceCount > 1 ? ` · ${d.licenceCount} licences` : ""} · generated ${esc(when)}</p>

<h2>Article 39 Obligations — Summary</h2>
<table><thead><tr><th>Clause</th><th>Obligation</th><th>Severity</th><th>Status</th></tr></thead>
<tbody>${obligationRows || '<tr><td colspan="4" class="muted">No obligations in scope.</td></tr>'}</tbody></table>

<h2>Metered Use (39.C)</h2>
<p class="muted">${d.usage.count} metered generation(s); gross £${(d.usage.grossPence / 100).toFixed(2)}, to talent £${(d.usage.talentPence / 100).toFixed(2)}. Downloads logged: ${d.downloads}.</p>

<h2>Strike History (39.G)</h2>
<p class="muted">${strikes.length === 0 ? "No strike events affecting this scope." : `${strikes.length} strike-related event(s) recorded.`}</p>

${d.breakdown ? renderBreakdownSection(d.breakdown) : `
<h2>Ledger (${d.events.length} events)</h2>
<table><thead><tr><th>#</th><th>Event</th><th>Clause</th><th>Hash</th></tr></thead>
<tbody>${eventRows || '<tr><td colspan="4" class="muted">No ledger events.</td></tr>'}</tbody></table>`}

<div class="seal">
  <strong>Tamper seal.</strong> Ledger tip hash: <code class="accent">${esc(d.ledgerTipHash || "(empty)")}</code><br/>
  Verify integrity at <code>/api/compliance/verify?certificateId=${esc(d.id)}</code>. Any post-issuance change to the ledger breaks this hash.
</div>
</body></html>`;
}

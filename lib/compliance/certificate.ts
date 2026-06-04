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
  talentProfiles,
  usageEvents,
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
  const map: Record<string, string> = { met: "#1a7f37", gap: "#c0392b", "n/a": "#888" };
  const label: Record<string, string> = { met: "✓ MET", gap: "⚠ GAP", "n/a": "N/A" };
  return `<span style="color:${map[status] ?? "#888"};font-weight:600">${label[status] ?? status}</span>`;
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
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#222;max-width:860px;margin:40px auto;padding:0 24px;line-height:1.5}
  h1{font-size:22px;margin:0 0 4px} h2{font-size:13px;text-transform:uppercase;letter-spacing:.12em;color:#666;margin:28px 0 8px}
  .muted{color:#777;font-size:13px} table{width:100%;border-collapse:collapse;font-size:13px;margin-top:6px}
  th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #eee} th{color:#888;font-weight:600;font-size:11px;text-transform:uppercase}
  .seal{margin-top:24px;padding:12px;border:1px solid #ddd;border-radius:6px;background:#fafafa;font-size:12px}
  code{font-family:ui-monospace,monospace;font-size:12px}
  .accent{color:#c0392b}
</style></head><body>
<h1>SAG-AFTRA Compliance Certificate</h1>
<p class="muted">${esc(d.regime)} · ${esc(d.scope)} ${esc(d.talentName ?? d.scopeId)}${d.licenceCount > 1 ? ` · ${d.licenceCount} licences` : ""} · generated ${esc(when)}</p>

<h2>Article 39 Obligations</h2>
<table><thead><tr><th>Clause</th><th>Obligation</th><th>Severity</th><th>Status</th></tr></thead>
<tbody>${obligationRows || '<tr><td colspan="4" class="muted">No obligations in scope.</td></tr>'}</tbody></table>

<h2>Metered Use (39.C)</h2>
<p class="muted">${d.usage.count} metered generation(s); gross £${(d.usage.grossPence / 100).toFixed(2)}, to talent £${(d.usage.talentPence / 100).toFixed(2)}. Downloads logged: ${d.downloads}.</p>

<h2>Strike History (39.G)</h2>
<p class="muted">${strikes.length === 0 ? "No strike events affecting this scope." : `${strikes.length} strike-related event(s) recorded.`}</p>

<h2>Ledger (${d.events.length} events)</h2>
<table><thead><tr><th>#</th><th>Event</th><th>Clause</th><th>Hash</th></tr></thead>
<tbody>${eventRows || '<tr><td colspan="4" class="muted">No ledger events.</td></tr>'}</tbody></table>

<div class="seal">
  <strong>Tamper seal.</strong> Ledger tip hash: <code class="accent">${esc(d.ledgerTipHash || "(empty)")}</code><br/>
  Verify integrity at <code>/api/compliance/verify?certificateId=${esc(d.id)}</code>. Any post-issuance change to the ledger breaks this hash.
</div>
</body></html>`;
}

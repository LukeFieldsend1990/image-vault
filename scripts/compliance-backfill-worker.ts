/**
 * One-off compliance backfill worker.
 *
 * Retroactively fires missing ledger events for approved licences:
 *   consent.granted        (39.B) — approval = base consent
 *   biometric.isolation_attested (39.E) — platform guarantee
 *   security.custody_attested    (39.H) — platform guarantee
 *   business_reason.recorded     (39.J) — licence fields = business reason
 *   use.metered            (39.C) — summary event if usage events exist
 *
 * HOW TO RUN (hits the real production D1):
 *   npx wrangler dev scripts/compliance-backfill-worker.ts --remote
 *   # then in a second terminal:
 *   curl http://localhost:8787/
 *
 * DO NOT deploy permanently. This is a one-shot maintenance tool.
 * After running, Ctrl-C the dev server — nothing is left deployed.
 */

// ── Crypto helpers (inlined from lib/compliance/ledger.ts) ─────────────────

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

interface AppendSpec {
  chainKey: string;
  eventType: string;
  clauseRef?: string;
  licenceId: string;
  talentId: string;
  actorId: string | null;
  scope?: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

async function appendEvent(db: D1Database, spec: AppendSpec): Promise<void> {
  // Read current chain tip
  const tipRow = await db
    .prepare(
      "SELECT seq, hash FROM compliance_events WHERE chain_key = ? ORDER BY seq DESC LIMIT 1",
    )
    .bind(spec.chainKey)
    .first<{ seq: number; hash: string }>();

  const seq = tipRow ? tipRow.seq + 1 : 0;
  const prevHash = tipRow ? tipRow.hash : spec.chainKey;

  const content = canonicalJson({
    chainKey: spec.chainKey,
    seq,
    eventType: spec.eventType,
    payload: spec.payload ?? {},
  });
  const hash = await sha256Hex(`${prevHash}${content}`);

  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  await db
    .prepare(
      `INSERT INTO compliance_events
        (id, chain_key, seq, event_type, regime, clause_ref, licence_id, talent_id,
         actor_id, scope_json, payload_json, prev_hash, hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      spec.chainKey,
      seq,
      spec.eventType,
      "sag_aftra",
      spec.clauseRef ?? null,
      spec.licenceId,
      spec.talentId,
      spec.actorId,
      spec.scope ? JSON.stringify(spec.scope) : "{}",
      spec.payload ? JSON.stringify(spec.payload) : "{}",
      prevHash,
      hash,
      now,
    )
    .run();
}

// ── Main handler ───────────────────────────────────────────────────────────

interface Env {
  DB: D1Database;
}

export default {
  async fetch(_req: Request, env: Env): Promise<Response> {
    const db = env.DB;
    let appended = 0;
    const errors: string[] = [];

    // All licences that were ever active (approved, or completed/ended).
    // SCRUB_PERIOD / EXPIRED / CLOSED passed through an approved state so their
    // obligations should have been recorded; backfill any that are missing.
    const { results: licences } = await db
      .prepare(
        `SELECT id, talent_id, licence_type, territory, project_name,
                production_company, intended_use
         FROM licences
         WHERE status IN ('APPROVED','SCRUB_PERIOD','EXPIRED','CLOSED')`,
      )
      .all<{
        id: string;
        talent_id: string;
        licence_type: string | null;
        territory: string | null;
        project_name: string;
        production_company: string | null;
        intended_use: string | null;
      }>();

    if (licences.length === 0) {
      return Response.json({ ok: true, message: "No approved licences found.", appended: 0 });
    }

    const licenceIds = licences.map((l) => l.id);

    // Existing events per licence (one query, all licences)
    const placeholders = licenceIds.map(() => "?").join(",");
    const { results: existingEvents } = await db
      .prepare(
        `SELECT licence_id, event_type FROM compliance_events WHERE licence_id IN (${placeholders})`,
      )
      .bind(...licenceIds)
      .all<{ licence_id: string; event_type: string }>();

    const hasEvent = new Set(existingEvents.map((e) => `${e.licence_id}:${e.event_type}`));

    // Usage event counts per licence
    const { results: usageCounts } = await db
      .prepare(
        `SELECT licence_id, COUNT(*) as n FROM usage_events WHERE licence_id IN (${placeholders}) GROUP BY licence_id`,
      )
      .bind(...licenceIds)
      .all<{ licence_id: string; n: number }>();

    const usageCountMap = new Map(usageCounts.map((r) => [r.licence_id, r.n]));

    for (const l of licences) {
      const chain = `licence:${l.id}`;
      const useType = l.licence_type ?? "commercial";
      const scope = l.territory ? { useType, territory: l.territory } : { useType };

      // 39.B — approval = consent
      if (!hasEvent.has(`${l.id}:consent.granted`)) {
        try {
          await appendEvent(db, {
            chainKey: chain, eventType: "consent.granted", clauseRef: "39.B",
            licenceId: l.id, talentId: l.talent_id, actorId: null, scope,
          });
          appended++;
        } catch (e) { errors.push(`${l.id} 39.B: ${String(e)}`); }
      }

      // 39.E — platform guarantee
      if (!hasEvent.has(`${l.id}:biometric.isolation_attested`)) {
        try {
          await appendEvent(db, {
            chainKey: chain, eventType: "biometric.isolation_attested", clauseRef: "39.E",
            licenceId: l.id, talentId: l.talent_id, actorId: null,
            payload: { note: "Image Vault platform guarantee — biometric data never leaves R2 custody — backfilled" },
          });
          appended++;
        } catch (e) { errors.push(`${l.id} 39.E: ${String(e)}`); }
      }

      // 39.H — platform guarantee
      if (!hasEvent.has(`${l.id}:security.custody_attested`)) {
        try {
          await appendEvent(db, {
            chainKey: chain, eventType: "security.custody_attested", clauseRef: "39.H",
            licenceId: l.id, talentId: l.talent_id, actorId: null,
            payload: { note: "Image Vault platform guarantee — all delivery via dual-custody download or bridge — backfilled" },
          });
          appended++;
        } catch (e) { errors.push(`${l.id} 39.H: ${String(e)}`); }
      }

      // 39.J — licence details = business reason
      if (!hasEvent.has(`${l.id}:business_reason.recorded`)) {
        try {
          await appendEvent(db, {
            chainKey: chain, eventType: "business_reason.recorded", clauseRef: "39.J",
            licenceId: l.id, talentId: l.talent_id, actorId: null,
            payload: {
              projectName: l.project_name,
              productionCompany: l.production_company,
              licenceType: l.licence_type,
              ...(l.intended_use ? { intendedUse: l.intended_use } : {}),
            },
          });
          appended++;
        } catch (e) { errors.push(`${l.id} 39.J: ${String(e)}`); }
      }

      // 39.C — one summary use.metered event if usage exists
      const usageCount = usageCountMap.get(l.id) ?? 0;
      if (usageCount > 0 && !hasEvent.has(`${l.id}:use.metered`)) {
        try {
          await appendEvent(db, {
            chainKey: chain, eventType: "use.metered", clauseRef: "39.C",
            licenceId: l.id, talentId: l.talent_id, actorId: null,
            payload: { note: `Backfilled — ${usageCount} pre-existing usage event(s)` },
          });
          appended++;
        } catch (e) { errors.push(`${l.id} 39.C: ${String(e)}`); }
      }
    }

    return Response.json({
      ok: true,
      licencesProcessed: licences.length,
      eventsAppended: appended,
      ...(errors.length ? { errors } : {}),
    });
  },
};

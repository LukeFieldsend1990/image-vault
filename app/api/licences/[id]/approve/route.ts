import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { licences, users, scanPackages, talentReps, geometryFingerprintJobs, royaltySources } from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { eq, and } from "drizzle-orm";
import { sendEmail } from "@/lib/email/send";
import { licenceApprovedEmail } from "@/lib/email/templates";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { sha256Hex, generateRoyaltyKey } from "@/lib/auth/requireRoyaltySource";
import { appendEvent, licenceChain } from "@/lib/compliance/ledger";
import { createNotification } from "@/lib/notifications/create";

// POST /api/licences/[id]/approve — talent/rep approves a pending licence request
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  if (session.role !== "talent" && session.role !== "rep" && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Talent may accept as-is or override the per-unit rate at approval time.
  let body: { agreedUnitType?: string; agreedUnitRatePence?: number } = {};
  try { body = await req.json(); } catch { /* body is optional */ }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const [licence] = await db
    .select({
      id: licences.id,
      talentId: licences.talentId,
      licenseeId: licences.licenseeId,
      status: licences.status,
      projectName: licences.projectName,
      packageId: licences.packageId,
      validFrom: licences.validFrom,
      validTo: licences.validTo,
      proposedFee: licences.proposedFee,
      proposedUnitType: licences.proposedUnitType,
      proposedUnitRatePence: licences.proposedUnitRatePence,
      organisationId: licences.organisationId,
      licenceType: licences.licenceType,
      territory: licences.territory,
    })
    .from(licences)
    .where(eq(licences.id, id))
    .limit(1)
    .all();

  // Check if geo-fingerprinting is enabled for this talent
  const [talentUser] = await db
    .select({ geoFingerprintEnabled: users.geoFingerprintEnabled })
    .from(users)
    .where(eq(users.id, licence?.talentId ?? ""))
    .limit(1)
    .all();

  if (!licence) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (session.role === "rep") {
    const link = await db
      .select({ id: talentReps.id })
      .from(talentReps)
      .where(and(eq(talentReps.repId, session.sub), eq(talentReps.talentId, licence.talentId)))
      .get();
    if (!link) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  } else if (session.role !== "admin" && licence.talentId !== session.sub) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (licence.status !== "PENDING") {
    return NextResponse.json({ error: "Licence is not in PENDING state" }, { status: 409 });
  }
  if (!licence.packageId) {
    return NextResponse.json({ error: "Licence has no package attached" }, { status: 409 });
  }
  const licencePackageId = licence.packageId;

  // Compute agreed/platform fees from proposedFee (15% platform commission)
  const agreedFee = licence.proposedFee ?? null;
  const platformFee = agreedFee !== null ? Math.round(agreedFee * 0.15) : null;

  // Resolve agreed unit rate — talent may override, otherwise accept licensee's proposal.
  const VALID_UNIT_TYPES = ["per_generation", "per_1k_inferences", "per_frame", "per_second"];
  const agreedUnitType =
    (typeof body.agreedUnitType === "string" && VALID_UNIT_TYPES.includes(body.agreedUnitType))
      ? body.agreedUnitType
      : (licence.proposedUnitType ?? null);
  const agreedUnitRatePence =
    (typeof body.agreedUnitRatePence === "number" && body.agreedUnitRatePence > 0)
      ? Math.floor(body.agreedUnitRatePence)
      : (licence.proposedUnitRatePence ?? null);

  await db
    .update(licences)
    .set({ status: "APPROVED", approvedBy: session.sub, approvedAt: now, agreedFee, platformFee, agreedUnitType, agreedUnitRatePence })
    .where(eq(licences.id, id));

  // Auto-satisfy compliance obligations on approval (fire-and-forget, non-fatal).
  // 39.B — talent approving the licence IS giving consent to the replica use.
  //         Additional consents (dubs, territory variants, rescripts) can be added
  //         separately via the compliance dashboard — this covers the base grant.
  // 39.E — Image Vault's architecture guarantees biometric isolation: producers
  //         never hold the data independently; it stays in platform R2.
  // 39.H — all delivery is via dual-custody download or bridge; platform IS custody.
  // 39.J — the licence itself (projectName + licenceType) is the recorded business reason.
  // Run under ctx.waitUntil so these ledger writes complete even after the
  // response is sent. A bare fire-and-forget IIFE can be dropped by the edge
  // runtime once the response returns, which previously left rep/talent-approved
  // licences with no consent events — surfacing 39.B/E/H/J as false gaps.
  const recordApprovalEvents = (async () => {
    try {
      const chain = licenceChain(id);
      const useType = licence.licenceType ?? "commercial";
      const scope = licence.territory ? { useType, territory: licence.territory } : { useType };
      await appendEvent(db, {
        chainKey: chain, eventType: "consent.granted", clauseRef: "39.B",
        licenceId: id, talentId: licence.talentId, actorId: session.sub, scope,
      });
      await appendEvent(db, {
        chainKey: chain, eventType: "biometric.isolation_attested", clauseRef: "39.E",
        licenceId: id, talentId: licence.talentId, actorId: null,
        payload: { note: "Image Vault platform guarantee — biometric data never leaves R2 custody" },
      });
      await appendEvent(db, {
        chainKey: chain, eventType: "security.custody_attested", clauseRef: "39.H",
        licenceId: id, talentId: licence.talentId, actorId: null,
        payload: { note: "Image Vault platform guarantee — all delivery via dual-custody download or bridge" },
      });
      await appendEvent(db, {
        chainKey: chain, eventType: "business_reason.recorded", clauseRef: "39.J",
        licenceId: id, talentId: licence.talentId, actorId: session.sub,
        payload: { projectName: licence.projectName, licenceType: useType },
      });
    } catch { /* non-fatal */ }
  })();
  try {
    getCloudflareContext().ctx.waitUntil(recordApprovalEvents);
  } catch {
    void recordApprovalEvents; // local dev — no request context
  }

  // Auto-create royalty source if a unit rate was agreed.
  let royaltyKey: string | null = null;
  if (agreedUnitType && agreedUnitRatePence) {
    try {
      const rawKey = generateRoyaltyKey();
      const apiKeyHash = await sha256Hex(rawKey);
      await db.insert(royaltySources).values({
        id: crypto.randomUUID(),
        licenceId: id,
        organisationId: licence.organisationId ?? null,
        displayName: licence.projectName,
        apiKeyHash,
        unitType: agreedUnitType as "per_generation" | "per_1k_inferences" | "per_frame" | "per_second",
        unitRatePence: agreedUnitRatePence,
        status: "active",
        createdAt: now,
        createdBy: session.sub,
      });
      royaltyKey = rawKey;
    } catch {
      // Non-fatal: source creation failure shouldn't block approval.
    }
  }

  // Enqueue geometric fingerprinting job (only if enabled for this talent)
  void (async () => {
    if (!talentUser?.geoFingerprintEnabled) return;
    try {
      const jobId = crypto.randomUUID();
      await db.insert(geometryFingerprintJobs).values({
        id: jobId,
        licenceId: id,
        packageId: licencePackageId,
        status: "queued",
        createdAt: now,
      });
      const { env } = getCloudflareContext();
      const queue = (env as unknown as Record<string, Queue>)["GEO_FINGERPRINT_QUEUE"];
      if (queue) await queue.send({ jobId });
    } catch {
      // Non-fatal: fingerprinting is best-effort
    }
  })();

  // Notify licensee (fire-and-forget)
  void (async () => {
    const [licenseeUser, pkg] = await Promise.all([
      db.select({ email: users.email }).from(users).where(eq(users.id, licence.licenseeId)).get(),
      db.select({ name: scanPackages.name }).from(scanPackages).where(eq(scanPackages.id, licencePackageId)).get(),
    ]);
    if (!licenseeUser?.email) return;
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://imagevault.ai";
    const { subject, html } = licenceApprovedEmail({
      licenseeEmail: licenseeUser.email,
      projectName: licence.projectName,
      packageName: pkg?.name ?? licencePackageId,
      validFrom: licence.validFrom,
      validTo: licence.validTo,
      downloadUrl: `${baseUrl}/licences`,
    });
    await sendEmail({ to: licenseeUser.email, subject, html });
    await createNotification(db, {
      userId: licence.licenseeId,
      type: "licence_approved",
      title: "Licence approved",
      body: licence.projectName,
      href: `/licences`,
    });
  })();

  return NextResponse.json({ ok: true, ...(royaltyKey ? { royaltyKey } : {}) });
}

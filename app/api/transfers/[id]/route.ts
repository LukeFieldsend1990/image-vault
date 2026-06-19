import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  scanTransfers,
  scanPackages,
  organisations,
  organisationMembers,
  licences,
  productionCast,
  users,
} from "@/lib/db/schema";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { hasRepAccess } from "@/lib/auth/repAccess";
import { notifyTalentAndReps } from "@/lib/notifications/create";
import { sendEmail } from "@/lib/email/send";
import {
  scanTransferReceivedEmail,
  scanTransferDecisionEmail,
  packageAttachedEmail,
} from "@/lib/email/templates";
import { eq, and } from "drizzle-orm";

const BASE_URL = () => process.env.NEXT_PUBLIC_BASE_URL ?? "https://changling.io";

// POST /api/transfers/[id] — { action: submit | accept | reject | cancel }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  let body: { action?: string };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const action = body.action;
  if (!action || !["submit", "accept", "reject", "cancel"].includes(action)) {
    return NextResponse.json({ error: "action must be submit | accept | reject | cancel" }, { status: 400 });
  }

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const transfer = await db.select().from(scanTransfers).where(eq(scanTransfers.id, id)).get();
  if (!transfer) return NextResponse.json({ error: "Transfer not found" }, { status: 404 });

  const pkg = await db
    .select({ id: scanPackages.id, name: scanPackages.name, status: scanPackages.status })
    .from(scanPackages)
    .where(eq(scanPackages.id, transfer.packageId))
    .get();

  const isOrgMember = !!(await db
    .select({ userId: organisationMembers.userId })
    .from(organisationMembers)
    .where(and(eq(organisationMembers.organisationId, transfer.fromOrgId), eq(organisationMembers.userId, session.sub)))
    .get());
  const isAdmin = session.role === "admin";

  // Talent/rep authorised over the target (for accept/reject)
  const isTargetTalent = session.sub === transfer.toTalentId;
  const isTargetRep = session.role === "rep" && (await hasRepAccess(session.sub, transfer.toTalentId));
  const canDecide = isTargetTalent || isTargetRep || isAdmin;

  // ── submit: org finished uploading; push to talent acceptance or attach to licence ──
  if (action === "submit") {
    if (!isOrgMember && !isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (transfer.status !== "pending") {
      return NextResponse.json({ error: `Cannot submit a ${transfer.status} transfer` }, { status: 409 });
    }
    if (!pkg || pkg.status !== "ready") {
      return NextResponse.json({ error: "Upload not complete — finish uploading files first" }, { status: 409 });
    }

    if (transfer.transferType === "to_licence" && transfer.targetLicenceId) {
      const licence = await db
        .select({ id: licences.id, talentId: licences.talentId, status: licences.status, projectName: licences.projectName, licenseeId: licences.licenseeId })
        .from(licences)
        .where(eq(licences.id, transfer.targetLicenceId))
        .get();
      if (!licence) return NextResponse.json({ error: "Target licence no longer exists" }, { status: 409 });
      if (licence.status !== "AWAITING_PACKAGE") {
        return NextResponse.json({ error: "Licence is no longer awaiting a package" }, { status: 409 });
      }

      // Reassign ownership to the licence's talent, then attach.
      await db.update(scanPackages).set({ talentId: licence.talentId, updatedAt: now }).where(eq(scanPackages.id, transfer.packageId));
      await db.update(licences).set({ packageId: transfer.packageId, status: "PENDING" }).where(eq(licences.id, licence.id));
      // Advance any production-cast row tied to this licence.
      await db.update(productionCast).set({ status: "scan_uploaded" }).where(eq(productionCast.licenceId, licence.id));
      await db.update(scanTransfers).set({ status: "accepted", submittedAt: now, decidedAt: now }).where(eq(scanTransfers.id, id));

      void (async () => {
        const base = BASE_URL();
        const [licenseeUser, talentUser] = await Promise.all([
          db.select({ email: users.email }).from(users).where(eq(users.id, licence.licenseeId)).get(),
          db.select({ email: users.email }).from(users).where(eq(users.id, licence.talentId)).get(),
        ]);
        if (licenseeUser?.email) {
          const { subject, html } = packageAttachedEmail({ recipientEmail: licenseeUser.email, projectName: licence.projectName, packageName: transfer.lookLabel ?? pkg.name, role: "industry", viewUrl: `${base}/licences` });
          await sendEmail({ to: licenseeUser.email, subject, html });
        }
        if (talentUser?.email) {
          const { subject, html } = packageAttachedEmail({ recipientEmail: talentUser.email, projectName: licence.projectName, packageName: transfer.lookLabel ?? pkg.name, role: "talent", viewUrl: `${base}/vault/licences` });
          await sendEmail({ to: talentUser.email, subject, html });
        }
      })();

      return NextResponse.json({ ok: true, status: "accepted" });
    }

    // to_talent — hold for talent acceptance.
    await db.update(scanTransfers).set({ status: "submitted", submittedAt: now }).where(eq(scanTransfers.id, id));
    void (async () => {
      const [talentUser, org] = await Promise.all([
        db.select({ email: users.email }).from(users).where(eq(users.id, transfer.toTalentId)).get(),
        db.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, transfer.fromOrgId)).get(),
      ]);
      const orgName = org?.name ?? "A capture company";
      if (talentUser?.email) {
        const { subject, html } = scanTransferReceivedEmail({ fromOrgName: orgName, lookLabel: transfer.lookLabel ?? pkg.name, viewUrl: `${BASE_URL()}/transfers` });
        await sendEmail({ to: talentUser.email, subject, html });
      }
      await notifyTalentAndReps(db, transfer.toTalentId, {
        type: "scan_delivery",
        title: "Scan delivery awaiting acceptance",
        body: `${orgName} delivered "${transfer.lookLabel ?? pkg.name}" — review and accept.`,
        href: "/transfers",
      });
    })();
    return NextResponse.json({ ok: true, status: "submitted" });
  }

  // ── accept / reject: talent (or rep) decides on a to_talent delivery ──
  if (action === "accept" || action === "reject") {
    if (!canDecide) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (transfer.transferType !== "to_talent") {
      return NextResponse.json({ error: "Only direct-to-talent deliveries are accepted here" }, { status: 409 });
    }
    if (transfer.status !== "submitted") {
      return NextResponse.json({ error: `Cannot ${action} a ${transfer.status} transfer` }, { status: 409 });
    }

    if (action === "accept") {
      await db.update(scanPackages).set({ talentId: transfer.toTalentId, updatedAt: now }).where(eq(scanPackages.id, transfer.packageId));
      await db.update(scanTransfers).set({ status: "accepted", decidedAt: now, decidedBy: session.sub }).where(eq(scanTransfers.id, id));
    } else {
      await db.update(scanPackages).set({ deletedAt: now, deletedBy: session.sub, updatedAt: now }).where(eq(scanPackages.id, transfer.packageId));
      await db.update(scanTransfers).set({ status: "rejected", decidedAt: now, decidedBy: session.sub }).where(eq(scanTransfers.id, id));
    }

    void (async () => {
      const creator = await db.select({ email: users.email }).from(users).where(eq(users.id, transfer.createdBy)).get();
      const decider = await db.select({ email: users.email }).from(users).where(eq(users.id, session.sub)).get();
      if (creator?.email) {
        const { subject, html } = scanTransferDecisionEmail({ lookLabel: transfer.lookLabel ?? pkg?.name ?? "scan", decision: action === "accept" ? "accepted" : "rejected", decidedByLabel: decider?.email, viewUrl: `${BASE_URL()}/transfers` });
        await sendEmail({ to: creator.email, subject, html });
      }
    })();

    return NextResponse.json({ ok: true, status: action === "accept" ? "accepted" : "rejected" });
  }

  // ── cancel: the sending org withdraws before a decision ──
  if (!isOrgMember && !isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (transfer.status !== "pending" && transfer.status !== "submitted") {
    return NextResponse.json({ error: `Cannot cancel a ${transfer.status} transfer` }, { status: 409 });
  }
  await db.update(scanPackages).set({ deletedAt: now, deletedBy: session.sub, updatedAt: now }).where(eq(scanPackages.id, transfer.packageId));
  await db.update(scanTransfers).set({ status: "cancelled", decidedAt: now, decidedBy: session.sub }).where(eq(scanTransfers.id, id));
  return NextResponse.json({ ok: true, status: "cancelled" });
}

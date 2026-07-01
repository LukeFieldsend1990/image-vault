import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { rslLicenseRequests } from "@/lib/db/schema";
import { getProfileBySlug, baseUrl } from "@/lib/rsl/profile";
import { derivePosture } from "@/lib/rsl/posture";
import { isPublic } from "@/lib/rsl/visibility";
import {
  OLP_GRANT_TYPE,
  decideForUsage,
  parseResourceToSlug,
  createRequest,
  findOpenRequest,
  grantRequest,
  storeDelivery,
  usageEndpoint,
} from "@/lib/rsl/olp";
import { capHeaders } from "@/lib/rsl/cap";
import { notifyTalentAndReps, notifyAdmins } from "@/lib/notifications/create";
import { checkRateLimit, getClientIp } from "@/lib/auth/rateLimit";
import { getRslSettings } from "@/lib/rsl/settings";
import { provisionLicensee } from "@/lib/rsl/licensee";
import { getRateCardForUsage } from "@/lib/rsl/rateCard";
import { createOlpLicence, approveOlpLicence, buildOffer } from "@/lib/rsl/funnel";

/**
 * OLP token endpoint (OAuth 2.0 extension, grant_type=rsl). A machine client
 * acquires an RSL license for a usage. Consent is enforced by the rights-holder's
 * posture — prohibited usages are denied, permitted usages are granted (green)
 * or routed for review (amber).
 */

interface OlpParams {
  grant_type?: string;
  resource?: string;
  usage?: string;
  client_id?: string;
  client_name?: string;
  contact_email?: string;
  intended_use?: string;
}

async function parseBody(req: NextRequest): Promise<OlpParams> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      return (await req.json()) as OlpParams;
    } catch {
      return {};
    }
  }
  // form-encoded (the OAuth default)
  try {
    const form = await req.formData();
    const get = (k: string) => {
      const v = form.get(k);
      return typeof v === "string" ? v : undefined;
    };
    return {
      grant_type: get("grant_type"),
      resource: get("resource"),
      usage: get("usage"),
      client_id: get("client_id"),
      client_name: get("client_name"),
      contact_email: get("contact_email"),
      intended_use: get("intended_use"),
    };
  } catch {
    return {};
  }
}

function oauthError(error: string, description: string, status: number, headers?: Record<string, string>) {
  return NextResponse.json({ error, error_description: description }, { status, headers });
}

export async function POST(req: NextRequest) {
  // Public, unauthenticated write — throttle per IP to stop request/notification
  // floods against a rights-holder.
  const rl = await checkRateLimit(getClientIp(req), {
    action: "rsl_olp_token",
    maxAttempts: 20,
    windowSeconds: 600,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited", error_description: "Too many licence requests. Try again later." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }

  const params = await parseBody(req);

  if (params.grant_type !== OLP_GRANT_TYPE) {
    return oauthError("unsupported_grant_type", `Use grant_type=${OLP_GRANT_TYPE}.`, 400);
  }
  const slug = parseResourceToSlug(params.resource);
  const usage = typeof params.usage === "string" ? params.usage.trim() : "";
  if (!slug) return oauthError("invalid_request", "A valid `resource` (slug or /c/ URL) is required.", 400);
  if (!usage) return oauthError("invalid_request", "A `usage` is required.", 400);

  const db = getDb();
  const row = await getProfileBySlug(db, slug);
  if (
    !row ||
    !isPublic({
      publishOptIn: row.profile.publishOptIn,
      adminApproved: row.profile.adminApproved,
      publicSlug: row.profile.publicSlug,
      vaultLocked: row.vaultLocked,
    })
  ) {
    // Don't confirm existence of non-public profiles.
    return oauthError("invalid_target", "No licensable resource at that address.", 404);
  }

  const posture = await derivePosture(db, row.profile.talentId);
  const decision = decideForUsage(posture, usage);

  if (decision.kind === "denied") {
    return oauthError("access_denied", "The rights-holder prohibits this usage of their likeness.", 403, capHeaders(slug));
  }
  if (decision.kind !== "auto_grant" && decision.kind !== "review") {
    return oauthError("invalid_request", `Unsupported usage "${usage}".`, 400);
  }
  const categoryId = decision.categoryId;
  const talentId = row.profile.talentId;
  const now = Math.floor(Date.now() / 1000);

  // Platform kill switch.
  const settings = await getRslSettings(db);
  if (!settings.olpEnabled) {
    return oauthError("temporarily_unavailable", "Licensing is temporarily disabled.", 503, capHeaders(slug));
  }

  // A contact email is required — it's how we reach the licensee's owner and
  // send the claim link.
  const contactEmail = typeof params.contact_email === "string" ? params.contact_email.trim().slice(0, 200) : "";
  if (!contactEmail) {
    return oauthError("invalid_request", "A contact_email is required to license this likeness.", 400, capHeaders(slug));
  }
  const clientId = typeof params.client_id === "string" ? params.client_id.slice(0, 200) : null;
  const clientName = typeof params.client_name === "string" ? params.client_name.slice(0, 200) : null;
  const intendedUse = typeof params.intended_use === "string" ? params.intended_use.slice(0, 500) : null;

  // Provision (or reuse) the claimable licensee stub.
  const licensee = await provisionLicensee(db, { clientId, clientName, contactEmail });
  if (licensee.blocked) {
    return oauthError("access_denied", "This client is blocked from licensing.", 403, capHeaders(slug));
  }

  const rateCard = await getRateCardForUsage(db, talentId, usage);
  const offer = buildOffer(usage, rateCard);

  // Reuse an open request for this client+usage, else create licence + request.
  let reqRow = await findOpenRequest(db, talentId, usage, licensee.clientRowId);
  let isNew = false;
  if (!reqRow) {
    const { licenceId } = await createOlpLicence(db, {
      talentId,
      usage,
      categoryId,
      licenseeId: licensee.licenseeId,
      organisationId: licensee.organisationId,
      clientName,
      intendedUse,
      rateCard,
    });
    const created = await createRequest(db, {
      talentId,
      usage,
      categoryId,
      postureLight: decision.kind === "auto_grant" ? "green" : "amber",
      clientId: licensee.clientRowId,
      clientName,
      contactEmail,
      intendedUse,
    });
    const newStatus = rateCard ? "offered" : "pending_review";
    await db.update(rslLicenseRequests).set({ licenceId, status: newStatus, updatedAt: now }).where(eq(rslLicenseRequests.id, created.id));
    reqRow = { ...created, licenceId, status: newStatus };
    isNew = true;
  }
  const licenceId = reqRow.licenceId!;

  // ── auto-license: posture green + a rate card that opts into auto-accept ──
  if (decision.kind === "auto_grant" && rateCard && rateCard.autoAccept && settings.autoAcceptEnabled && reqRow.status !== "granted") {
    const { royaltyKey } = await approveOlpLicence(db, { licenceId, approverId: talentId, clientId: licensee.clientRowId });
    const grant = await grantRequest(db, reqRow.id, null);
    await db.update(rslLicenseRequests).set({ acceptedAt: now, updatedAt: now }).where(eq(rslLicenseRequests.id, reqRow.id));
    const delivery = {
      license: grant.rawToken,
      royalty_key: royaltyKey,
      usage_endpoint: usageEndpoint(),
      unit_type: rateCard.unitType,
      unit_rate_cents: rateCard.unitRatePence,
      expires_at: grant.expiresAt,
    };
    await storeDelivery(reqRow.id, JSON.stringify(delivery));
    void notifyTalentAndReps(db, talentId, {
      type: "rsl_license_granted",
      title: "AI licence auto-granted",
      body: `${clientName || "A machine client"} licensed your likeness for ${usage} at your published rate.`,
      href: "/royalties",
    });
    return NextResponse.json(
      { status: "granted", request_id: reqRow.id, usage, offer, token_type: "rsl-license", ...delivery },
      { status: 200, headers: capHeaders(slug) },
    );
  }

  // ── otherwise: route to a human (offered = priced, pending_review = needs a price) ──
  if (isNew) {
    const who = clientName || "A machine client";
    void notifyTalentAndReps(db, talentId, {
      type: "rsl_license_request",
      title: "AI licence request",
      body: `${who} requested to license your likeness for ${usage}.`,
      href: "/vault/requests",
    });
    void notifyAdmins(db, {
      type: "rsl_license_request_admin",
      title: "AI licence request to review",
      body: `${who} requested to license a talent's likeness for ${usage}.`,
      href: "/admin/rsl",
    });
  }
  return NextResponse.json(
    {
      status: reqRow.status === "offered" ? "offer_available" : "authorization_pending",
      request_id: reqRow.id,
      poll_url: `${baseUrl()}/api/rsl/olp/requests/${reqRow.id}`,
      usage,
      offer,
    },
    { status: 202, headers: capHeaders(slug) },
  );
}

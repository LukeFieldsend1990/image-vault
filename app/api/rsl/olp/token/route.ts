import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getProfileBySlug, consentProfileUrl, baseUrl } from "@/lib/rsl/profile";
import { derivePosture } from "@/lib/rsl/posture";
import { isPublic } from "@/lib/rsl/visibility";
import {
  OLP_GRANT_TYPE,
  decideForUsage,
  offerForUsage,
  parseResourceToSlug,
  createRequest,
  findOpenRequest,
  grantRequest,
} from "@/lib/rsl/olp";
import { capHeaders } from "@/lib/rsl/cap";
import { notifyTalentAndReps } from "@/lib/notifications/create";

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
  const contentUrl = consentProfileUrl(slug);

  if (decision.kind === "invalid") {
    return oauthError("invalid_request", `Unsupported usage "${usage}".`, 400);
  }
  if (decision.kind === "denied") {
    return oauthError(
      "access_denied",
      "The rights-holder prohibits this usage of their likeness.",
      403,
      capHeaders(slug),
    );
  }

  const clientId = typeof params.client_id === "string" ? params.client_id.slice(0, 200) : null;
  const clientName = typeof params.client_name === "string" ? params.client_name.slice(0, 200) : null;
  const contactEmail = typeof params.contact_email === "string" ? params.contact_email.slice(0, 200) : null;
  const intendedUse = typeof params.intended_use === "string" ? params.intended_use.slice(0, 500) : null;

  // ── green: standing instruction = always → auto-grant consent, mint token ──
  if (decision.kind === "auto_grant") {
    const reqRow = await createRequest(db, {
      talentId: row.profile.talentId,
      usage,
      categoryId: decision.categoryId,
      postureLight: "green",
      clientId,
      clientName,
      contactEmail,
      intendedUse,
    });
    const grant = await grantRequest(db, reqRow.id, null);
    void notifyTalentAndReps(db, row.profile.talentId, {
      type: "rsl_license_granted",
      title: "AI licence auto-granted",
      body: `${clientName || clientId || "A machine client"} acquired an RSL licence for ${usage} (auto-granted per your standing instruction).`,
      href: "/settings",
    });
    return NextResponse.json(
      {
        status: "granted",
        request_id: reqRow.id,
        license: grant.rawToken,
        token_type: "rsl-license",
        usage,
        expires_at: grant.expiresAt,
        offer: offerForUsage(usage, contentUrl),
      },
      { status: 200, headers: capHeaders(slug) },
    );
  }

  // ── amber: permitted with terms → route to the rights-holder for review ──
  const existing = await findOpenRequest(db, row.profile.talentId, usage, clientId);
  const reqRow = existing ?? (await createRequest(db, {
    talentId: row.profile.talentId,
    usage,
    categoryId: decision.categoryId,
    postureLight: "amber",
    clientId,
    clientName,
    contactEmail,
    intendedUse,
  }));
  if (!existing) {
    void notifyTalentAndReps(db, row.profile.talentId, {
      type: "rsl_license_request",
      title: "AI licence request",
      body: `${clientName || clientId || "A machine client"} requested to license your likeness for ${usage}.`,
      href: "/settings",
    });
  }
  return NextResponse.json(
    {
      status: "authorization_pending",
      request_id: reqRow.id,
      poll_url: `${baseUrl()}/api/rsl/olp/requests/${reqRow.id}`,
      usage,
      offer: offerForUsage(usage, contentUrl),
    },
    { status: 202, headers: capHeaders(slug) },
  );
}

import { NextResponse } from "next/server";
import { baseUrl, olpServerUrl } from "@/lib/rsl/profile";
import { OLP_GRANT_TYPE, SUPPORTED_USAGES } from "@/lib/rsl/olp";

/**
 * OLP server metadata (discovery). The `server` attribute in every RSL license
 * document points here; a machine client fetches this to learn the token and
 * introspection endpoints, mirroring OAuth 2.0 authorization-server metadata.
 */
export function GET() {
  const server = olpServerUrl();
  return NextResponse.json(
    {
      name: "ImageVault RSL License Server",
      rsl_version: "1.0",
      issuer: baseUrl(),
      token_endpoint: `${server}/token`,
      introspection_endpoint: `${server}/introspect`,
      grant_types_supported: [OLP_GRANT_TYPE],
      usage_types_supported: SUPPORTED_USAGES,
      token_type: "rsl-license",
      license_document_pattern: `${baseUrl()}/api/rsl/{slug}/license.xml`,
      notes:
        "Acquire a license with POST /token (grant_type=rsl, resource=<slug or /c/ URL>, usage). " +
        "Consent is enforced by the rights-holder's posture: prohibited usages are denied, " +
        "permitted-with-terms usages are routed to the rights-holder for approval.",
    },
    { headers: { "Cache-Control": "public, max-age=3600" } },
  );
}

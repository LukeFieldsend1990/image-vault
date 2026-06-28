/**
 * Crawler Authentication Protocol (CAP) helpers.
 *
 * When an automated client touches an RSL-licensed resource without a valid
 * license, point it at where to acquire one: an HTTP `Link: rel="license"`
 * header (RSL discovery) plus a `WWW-Authenticate` challenge naming the OLP
 * token endpoint. Use linkHeader() to advertise terms on any response, or
 * challenge() to refuse access while telling the client how to license.
 */

import { olpServerUrl, licenseXmlUrl } from "./profile";

/** Value for a `Link: rel="license"` header pointing at a profile's RSL doc. */
export function linkHeader(slug: string): string {
  return `<${licenseXmlUrl(slug)}>; rel="license"; type="application/rsl+xml"`;
}

/** Headers that advertise the OLP token endpoint as the way to authenticate. */
export function capHeaders(slug?: string): Record<string, string> {
  const server = olpServerUrl();
  const headers: Record<string, string> = {
    "WWW-Authenticate": `RSL realm="image-vault", grant_type="rsl", token_endpoint="${server}/token"`,
  };
  if (slug) headers["Link"] = linkHeader(slug);
  return headers;
}

/**
 * A 402 Payment Required challenge for a gated resource — the canonical CAP
 * response telling an unlicensed crawler to acquire a license via OLP.
 */
export function challenge(slug?: string): Response {
  return new Response(
    JSON.stringify({
      error: "license_required",
      error_description: "Acquire an RSL license via the Open License Protocol endpoint.",
      token_endpoint: `${olpServerUrl()}/token`,
    }),
    { status: 402, headers: { "Content-Type": "application/json", ...capHeaders(slug) } },
  );
}

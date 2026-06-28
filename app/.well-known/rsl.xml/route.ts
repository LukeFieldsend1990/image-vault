import { NextResponse } from "next/server";
import { baseUrl, olpServerUrl } from "@/lib/rsl/profile";
import { renderPlatformRsl } from "@/lib/rsl/xml";

/**
 * Platform-level RSL policy (the "label on the front door"). Names no talent
 * and exposes nothing per-person: a default-deny baseline that routes all
 * licensing through the Open License Protocol endpoint.
 */
export function GET() {
  const xml = renderPlatformRsl({ siteUrl: `${baseUrl()}/`, server: olpServerUrl() });
  return new NextResponse(xml, {
    status: 200,
    headers: { "Content-Type": "application/rsl+xml; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}

/**
 * RSL 1.0 document rendering (https://rslstandard.org/rsl).
 *
 * We emit machine-readable licensing terms that point a non-human agent BACK to
 * ImageVault as the place to license — never any scan bytes or biometric data.
 * Default-deny: red categories are emitted as explicit <prohibits>; amber/green
 * as <permits>, with amber (permitted-with-terms) carrying a <payment> pointer
 * to our Open License Protocol endpoint (Phase 2).
 */

import type { Posture } from "./posture";
import { RSL_PAYMENT_TYPE } from "./posture";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface TalentRslInput {
  contentUrl: string; // public /c/<slug> URL
  server: string; // OLP endpoint
  posture: Posture;
}

/** Render the per-talent RSL license document. */
export function renderTalentRsl(input: TalentRslInput): string {
  const { contentUrl, server, posture } = input;
  const blocks: string[] = [];

  for (const c of posture.categories) {
    if (!c.rslUsage) continue; // stub categories emit no RSL term (Q2)
    if (c.light === "red") {
      blocks.push(
        `    <license>\n      <prohibits type="usage">${esc(c.rslUsage)}</prohibits>\n    </license>`,
      );
      continue;
    }
    // amber + green both permit; amber additionally requires terms via payment.
    const lines = [`      <permits type="usage">${esc(c.rslUsage)}</permits>`];
    if (c.light === "amber") {
      const payType = RSL_PAYMENT_TYPE[c.rslUsage] ?? "inference";
      lines.push(
        `      <payment type="${esc(payType)}">\n        <standard>${esc(server)}</standard>\n      </payment>`,
      );
    }
    blocks.push(`    <license>\n${lines.join("\n")}\n    </license>`);
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<!-- ImageVault — machine-readable AI-use licensing terms for this likeness.",
    "     To license, use the Open License Protocol endpoint in the `server` attribute.",
    "     Anything not explicitly permitted below is prohibited (default-deny). -->",
    '<rsl xmlns="https://rslstandard.org/rsl">',
    `  <content url="${esc(contentUrl)}" server="${esc(server)}">`,
    blocks.join("\n"),
    "  </content>",
    "</rsl>",
    "",
  ].join("\n");
}

/**
 * Generic platform-level RSL policy served at /.well-known/rsl.xml. Names no
 * talent and exposes nothing per-person — a protective default-deny baseline
 * that routes all licensing through the OLP endpoint.
 */
export function renderPlatformRsl(input: { siteUrl: string; server: string }): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<!-- ImageVault platform licensing policy. Content hosted here is licensable",
    "     only via the Open License Protocol endpoint below. Default-deny for AI use. -->",
    '<rsl xmlns="https://rslstandard.org/rsl">',
    `  <content url="${esc(input.siteUrl)}" server="${esc(input.server)}">`,
    "    <license>",
    '      <prohibits type="usage">ai-train</prohibits>',
    '      <prohibits type="usage">ai-use</prohibits>',
    "    </license>",
    "  </content>",
    "</rsl>",
    "",
  ].join("\n");
}

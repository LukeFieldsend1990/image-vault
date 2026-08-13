/**
 * Takedown-report letter builder.
 *
 * We are filing under the impersonation / personal-rights heading, not the
 * copyright heading — the talent's likeness is not their copyright, and Meta
 * routes those two report types to different teams. The letter therefore
 * frames the complaint as unauthorised likeness use by an authorised agent,
 * cites the evidence the monitor already gathered, and asks for removal.
 *
 * The recipient (ip@instagram.com in practice) processes rights-holder mail
 * and will forward or redirect if this is the wrong queue — better than us
 * guessing which internal address is right.
 *
 * Nothing here is a legal opinion — this is a report letter, not a lawsuit —
 * but the structure follows how established rights-management firms word
 * their reports so a Meta reviewer can act on it without further clarification.
 */

export interface TakedownLetterInput {
  talent: {
    fullName: string;
    knownFor: string[];              // ["Black Widow", "Avengers: Endgame", ...]
  };
  hit: {
    platform: string;                // "instagram"
    contentUrl: string;
    authorHandle: string | null;
    caption: string | null;
    riskLevel: string;
    aiGeneratedLikelihood: number;
    aiRationale: string | null;
    matchSignals: string[];
    detectedAt: number;
  };
  reporter: {
    // The admin sending the report. Meta expects a real human name in the
    // sign-off — the platform is the agent, but a person authorises the send.
    fullName: string;
    email: string;
  };
  reference: string;                  // internal case reference, echoed by Meta
}

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
  x: "X",
};

/**
 * Compose the subject + HTML body for the report.
 *
 * The subject leads with the platform's report-triage keywords ("Report of
 * unauthorised likeness / AI-generated impersonation") so it lands in the
 * right queue. The reference is echoed so any reply from Meta ties back to
 * our row without our operator having to look it up.
 */
export function buildTakedownLetter(input: TakedownLetterInput): { subject: string; html: string } {
  const platform = PLATFORM_LABEL[input.hit.platform] ?? input.hit.platform;
  const detectedIso = new Date(input.hit.detectedAt * 1000).toISOString();
  const talentKnownFor =
    input.talent.knownFor.length > 0 ? input.talent.knownFor.slice(0, 5).join(", ") : "(filmography on file)";

  const subject = `Report of unauthorised likeness / AI-generated impersonation — ${input.talent.fullName} — ref ${input.reference}`;

  const evidenceRows = [
    ["Reported URL", esc(input.hit.contentUrl)],
    ["Reported account", input.hit.authorHandle ? esc(input.hit.authorHandle) : "(not surfaced by the post)"],
    ["Platform", esc(platform)],
    ["First detected", esc(detectedIso)],
    ["AI-generated likelihood", `${input.hit.aiGeneratedLikelihood}%`],
    ["Risk classification", esc(input.hit.riskLevel)],
  ];

  const signalsList = input.hit.matchSignals
    .map((s) => `<li style="margin: 4px 0;">${esc(s)}</li>`)
    .join("");

  const captionBlock = input.hit.caption
    ? `<p style="margin: 12px 0 0; color: #4a4a4a;"><strong>Content caption (as posted):</strong></p>
       <blockquote style="margin: 8px 0 0; padding: 8px 12px; border-left: 3px solid #bc3d2c; color: #333; font-size: 14px;">${esc(
         input.hit.caption.slice(0, 800)
       )}${input.hit.caption.length > 800 ? "…" : ""}</blockquote>`
    : "";

  const rationaleBlock = input.hit.aiRationale
    ? `<p style="margin: 12px 0 0;"><strong>Adjudicator rationale:</strong> ${esc(input.hit.aiRationale)}</p>`
    : "";

  const html = `<!doctype html>
<html><body style="font-family: -apple-system, Helvetica, Arial, sans-serif; color: #1a1a1a; line-height: 1.55; max-width: 640px; margin: 0 auto; padding: 24px;">

<p style="margin: 0 0 8px; color: #4a4a4a; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em;">
  ImageVault Enforcement · Reference ${esc(input.reference)}
</p>

<h1 style="margin: 0 0 20px; font-size: 20px; line-height: 1.3;">
  ${esc(platform)} Trust & Safety
</h1>

<p>To whom it may concern,</p>

<p>ImageVault is the authorised digital-likeness agent of <strong>${esc(input.talent.fullName)}</strong>
(known for ${esc(talentKnownFor)}). A signed authorisation naming ImageVault as
${esc(input.talent.fullName)}'s representative for platform reports is on file and available on request.</p>

<p>We are reporting the following ${esc(platform)} content for <strong>unauthorised use of
${esc(input.talent.fullName)}'s likeness in synthetic / AI-generated media</strong>. The account
publishing this content is not authorised by ${esc(input.talent.fullName)}, and the content in
question was flagged by our detection system as AI-generated with high confidence.</p>

<h2 style="margin: 24px 0 8px; font-size: 15px;">Reported content</h2>
<table style="width: 100%; border-collapse: collapse; font-size: 14px;">
  ${evidenceRows
    .map(
      ([k, v]) => `<tr>
    <td style="padding: 6px 12px 6px 0; color: #4a4a4a; width: 40%; vertical-align: top;">${esc(k)}</td>
    <td style="padding: 6px 0; word-break: break-all;">${v}</td>
  </tr>`
    )
    .join("")}
</table>

${captionBlock}

${
  signalsList
    ? `<h2 style="margin: 24px 0 8px; font-size: 15px;">Detection signals</h2>
       <ul style="margin: 0; padding-left: 20px;">${signalsList}</ul>`
    : ""
}

${rationaleBlock}

<h2 style="margin: 24px 0 8px; font-size: 15px;">Requested action</h2>
<p>We respectfully request that ${esc(platform)} remove the reported content and, if the account
is a repeat offender in your records, apply your standard enforcement action against the account.</p>

<p>Please cite our reference <strong>${esc(input.reference)}</strong> in any reply so it ties back
to this case in our system.</p>

<p style="margin: 24px 0 4px;">Regards,</p>
<p style="margin: 0;">${esc(input.reporter.fullName)}<br/>
<span style="color: #4a4a4a; font-size: 13px;">On behalf of ImageVault, authorised agent of ${esc(
    input.talent.fullName
  )}</span><br/>
<span style="color: #4a4a4a; font-size: 13px;">Reply-to: ${esc(input.reporter.email)}</span></p>

</body></html>`;

  return { subject, html };
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

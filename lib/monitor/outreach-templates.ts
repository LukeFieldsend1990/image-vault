/**
 * Message templates for reaching out to accounts posting AI content of a
 * protected talent. Not sent by us — the operator pastes each message into
 * the platform's DM composer, then logs the outreach. Templates therefore
 * need to survive being read cold by the recipient with no ImageVault
 * branding context, and match the tone the platform expects (Instagram DMs
 * that read like legal letters get archived instantly).
 */

export type OutreachPurpose =
  | "licence_offer"
  | "consent_request"
  | "takedown_request"
  | "other";

export interface TemplateInput {
  talentName: string;
  accountHandle: string; // without the leading '@'
  platform: string; // instagram | tiktok | youtube | x
}

export interface Template {
  purpose: OutreachPurpose;
  label: string;
  body: string;
}

/**
 * Return every canned template pre-filled with the talent + account facts,
 * ordered from "warmest" (licence offer, no threat) to "coldest" (takedown
 * request). The operator can pick one and edit it further before sending.
 */
export function buildTemplates(input: TemplateInput): Template[] {
  const { talentName, accountHandle } = input;
  const handleWithAt = accountHandle.startsWith("@") ? accountHandle : `@${accountHandle}`;

  return [
    {
      purpose: "licence_offer",
      label: "Licence offer",
      body:
        `Hi ${handleWithAt},\n\n` +
        `I'm reaching out on behalf of ${talentName}. We've noticed you've been creating ` +
        `AI-generated content featuring ${talentName}, and we wanted to open a conversation ` +
        `rather than send takedowns.\n\n` +
        `${talentName} is exploring a licensed programme where creators can produce AI ` +
        `content of them within an agreed framework — including revenue sharing on ` +
        `monetised posts. If that's something you'd be interested in, reply here and I'll ` +
        `send more details on how it works.\n\n` +
        `Thanks for reading.`,
    },
    {
      purpose: "consent_request",
      label: "Consent request",
      body:
        `Hi ${handleWithAt},\n\n` +
        `Writing on behalf of ${talentName}. Your recent posts using their likeness ` +
        `haven't been authorised, and we'd like to understand the intent behind the ` +
        `account before taking any further action.\n\n` +
        `Are these fan-made pieces, a commercial venture, or something else? ${talentName} ` +
        `is open to a range of arrangements — including licensing paths for AI content ` +
        `— but needs to know what's happening first.\n\n` +
        `A short reply here is enough. Thanks.`,
    },
    {
      purpose: "takedown_request",
      label: "Takedown request",
      body:
        `Hi ${handleWithAt},\n\n` +
        `Writing on behalf of ${talentName}. The AI-generated content you've been posting ` +
        `uses ${talentName}'s likeness without authorisation and we're asking you to ` +
        `remove it.\n\n` +
        `If you don't remove the posts we'll file a formal report with the platform, which ` +
        `can result in account restrictions. If you'd prefer to discuss a licensed path — ` +
        `${talentName} is open to some arrangements — reply here.\n\n` +
        `Please respond within 7 days.`,
    },
  ];
}

/**
 * Deep-link the operator to the platform's DM compose surface for this
 * account. Only Instagram exposes a public compose URL (ig.me); TikTok and
 * YouTube require manually visiting the profile and clicking through, so
 * we fall back to their profile URL and let the caller click Message.
 */
export function composeUrlFor(platform: string, handle: string): string | null {
  const clean = handle.replace(/^@/, "");
  switch (platform) {
    case "instagram":
      return `https://ig.me/m/${clean}`;
    case "tiktok":
      return `https://www.tiktok.com/@${clean}`;
    case "youtube":
      // YouTube handles vs channel names are a mess; @-prefix works for
      // both new @handles and legacy usernames.
      return `https://www.youtube.com/@${clean}`;
    case "x":
      return `https://x.com/messages/compose?recipient_id=${clean}`;
    default:
      return null;
  }
}

/**
 * Versioned performer consent-document copy.
 *
 * Plain-English wording a performer (or their agent) reads before consenting to
 * the use of their biometric data on a production. The version string is stored
 * on every acceptance (consentAcceptances.documentVersion) so we can always
 * prove which wording was shown.
 *
 * Per product decision (2026-06): there is NO signature ceremony (a single
 * attestation + confirm is enough) and NO fixed retention-period section until
 * legal sets a number — so the "how long the data is held" section is omitted.
 *
 * The interactive "what you're consenting to" section is rendered by the client
 * from lib/consent/use-categories.ts; this module supplies the static prose.
 */

/** Bump when the wording below changes. Format: YYYY.MM. */
export const CONSENT_DOCUMENT_VERSION = "2026.06";

export interface ConsentDocSection {
  /** Display number, e.g. "1". */
  num: string;
  heading: string;
  /** Body paragraphs (already interpolated). */
  paragraphs: string[];
  /** Optional emphasised callout under the paragraphs. */
  emphasis?: string;
}

export interface ConsentDocCopy {
  version: string;
  kicker: string;
  title: string;
  lead: string;
  /** Sections shown before the interactive consent picker. */
  before: ConsentDocSection[];
  /** Heading + intro for the interactive consent picker (the use categories). */
  consentSection: { num: string; heading: string; intro: string };
  /** Sections shown after the interactive consent picker. */
  after: ConsentDocSection[];
  /** Attestation line shown next to the confirm checkbox. {name} is interpolated. */
  attestation: string;
}

/**
 * Build the resolved consent-document copy for a specific production. Pure — no
 * DB access. Names are interpolated into the wording.
 */
export function buildConsentDocCopy(input: {
  productionName: string;
  companyName: string;
  performerName: string;
}): ConsentDocCopy {
  const { productionName, companyName, performerName } = input;
  return {
    version: CONSENT_DOCUMENT_VERSION,
    kicker: "Consent document · Per-production",
    title: `Consent to use your biometric data on ${productionName}.`,
    lead:
      "Please read this carefully. It explains what's being asked, what each use means, and lets you consent only to the uses you're comfortable with. You can leave at any time without confirming.",
    before: [
      {
        num: "1",
        heading: "What's being captured",
        paragraphs: [
          `${companyName} will create a digital record of your physical likeness. In practical terms, this is a 3D scan of your face and body, including precise measurements, surface detail, and skin texture. It may also include a recording of your voice for reference.`,
          "The scan happens in a capture session, usually 30 to 60 minutes, with a professional capture company on location or at a studio.",
        ],
        emphasis:
          "This data is classed as special category biometric data under UK and EU data protection law. It needs your specific, informed, freely-given consent to be captured and used. That's what this document is for.",
      },
    ],
    consentSection: {
      num: "2",
      heading: "What you're consenting to",
      intro: `${productionName} has asked for consent on the uses marked Requested — they're pre-ticked for you to confirm. Untick anything you don't agree to. You can also tick additional uses if you're happy to consent to more than they've asked for.`,
    },
    after: [
      {
        num: "3",
        heading: "Who'll have access to your data",
        paragraphs: [
          `${companyName} is the controller of this data while you haven't yet registered on ImageVault. They are responsible for keeping it safe.`,
          `Vendors hired by ${productionName} may have access to your scan data, but only within the scope of what you've consented to above and only for the work they're doing on this production.`,
          "If you later register on ImageVault, you (or your agent acting on your standing instructions) will be able to control access directly.",
        ],
      },
      {
        num: "4",
        heading: "Where the data goes",
        paragraphs: [
          "Your data is held in ImageVault, a UK-based platform built specifically for biometric data in the film and television industry.",
          "Vendors who need to read the data do so through ImageVault's secure connection, the Bridge. The data is decrypted only inside the vendor's controlled folder, and is never written to render farms, indexing systems, or general storage.",
          "ImageVault never sells your data, never trains AI models on it without your explicit consent under §39G, and never uses it for anything outside what you've authorised.",
        ],
      },
      {
        num: "5",
        heading: "Your right to withdraw consent",
        paragraphs: [
          "You have the right to withdraw your consent at any time. This is a legal right under the UK GDPR (Article 7(3)) and SAG-AFTRA section 39.",
          "Withdrawal stops new uses going forward. It does not undo lawful past uses: if your scan has already been used in shots, those shots remain lawful, but no new work using your data can begin after you withdraw.",
        ],
      },
    ],
    attestation: `I am ${performerName}. I have read and understood this document. I am confirming freely. I understand which uses I have consented to and which I have not, and I understand my right to withdraw.`,
  };
}

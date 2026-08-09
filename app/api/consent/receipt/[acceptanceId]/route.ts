import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireSession, isErrorResponse } from "@/lib/auth/requireSession";
import { authorizeCastConsent, authorizeLicenceConsent } from "@/lib/consent/authorize";
import { buildConsentReceipt, type ConsentReceipt } from "@/lib/consent/receipt";
import { getOrMintSeal } from "@/lib/compliance/seal";
import { consentAcceptances } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export interface ReceiptResponse {
  receipt: ConsentReceipt;
  /** Opaque public ref, present only once the acceptance has been chained. */
  sealRef: string | null;
  sealHash: string | null;
  verifyUrl: string | null;
  generatedAt: number;
}

/**
 * GET /api/consent/receipt/[acceptanceId]
 *
 * Reuses the consent surface's own authorisation: whoever may view the consent
 * document may view the receipt for it. A guest acceptance (no licence, no
 * account) is reachable only through the tokenised consent link, which returns
 * the receipt inline — so there is deliberately no unauthenticated path here.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ acceptanceId: string }> },
) {
  const session = await requireSession(req);
  if (isErrorResponse(session)) return session;

  const { acceptanceId } = await params;
  const db = getDb();

  const acc = await db
    .select({ licenceId: consentAcceptances.licenceId, castId: consentAcceptances.castId })
    .from(consentAcceptances)
    .where(eq(consentAcceptances.id, acceptanceId))
    .get();
  if (!acc) return NextResponse.json({ error: "Receipt not found" }, { status: 404 });

  // Authorise against whichever surface the acceptance belongs to.
  let allowed = false;
  if (acc.licenceId) {
    const auth = await authorizeLicenceConsent(db, session, acc.licenceId);
    allowed = Boolean(auth?.canView);
  } else if (acc.castId) {
    const auth = await authorizeCastConsent(db, session, acc.castId);
    allowed = Boolean(auth?.canView);
  }
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const receipt = await buildConsentReceipt(db, acceptanceId);
  if (!receipt) return NextResponse.json({ error: "Receipt not found" }, { status: 404 });

  // Only a chained acceptance can carry a seal — there is nothing to verify
  // against until the grants exist on the ledger. Guest receipts say so rather
  // than printing a QR that resolves to nothing.
  let sealRef: string | null = null;
  let sealHash: string | null = null;
  let verifyUrl: string | null = null;

  if (receipt.chained) {
    const seal = await getOrMintSeal(db, {
      kind: "consent_receipt",
      subjectType: "licence",
      subjectId: receipt.licenceId ?? acceptanceId,
      // Public page — initials and the document reference only.
      subjectLabel: `${initials(receipt.performerName)} · ${receipt.reference}`,
      chainKeys: receipt.chainKeys,
      issuedBy: session.sub,
    });
    sealRef = seal.ref;
    sealHash = seal.sealHash;
    verifyUrl = `${process.env.NEXT_PUBLIC_BASE_URL ?? "https://imagevault.ai"}/verify/${seal.ref}`;
  }

  const response: ReceiptResponse = {
    receipt,
    sealRef,
    sealHash,
    verifyUrl,
    generatedAt: Math.floor(Date.now() / 1000),
  };
  return NextResponse.json(response);
}

/** Initials only — the public verification page must not disclose the name. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  return parts
    .slice(0, 3)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

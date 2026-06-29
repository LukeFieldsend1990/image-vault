import ConsentDocumentClient from "../../consent-document-client";

// Actionable cast-level consent surface for a production-held placeholder. The
// reserved rep pre-negotiates the §39 scope with the production and then sends the
// document to their client for final consent; the production responds to counters
// here too. Authorisation is enforced by the cast consent API (assigned rep,
// production org owner/admin, or admin).
export default async function ConsentCastPage({ params }: { params: Promise<{ castId: string }> }) {
  const { castId } = await params;
  return <ConsentDocumentClient source={{ kind: "cast", castId }} />;
}

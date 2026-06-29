import ConsentDocumentClient from "../../consent-document-client";

// Read-only preview of a reserved role's consent document for the assigned agent.
// Auth is enforced by the preview API (the rep assigned to the slot, or admin).
export default async function ConsentPreviewPage({ params }: { params: Promise<{ castId: string }> }) {
  const { castId } = await params;
  return <ConsentDocumentClient source={{ kind: "preview", castId }} />;
}

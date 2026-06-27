import ConsentDocumentClient from "../consent-document-client";

// Registered consent document for a licence. Auth is enforced by the document
// API (talent owner, their agent, the licensee, or admin).
export default async function ConsentLicencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ConsentDocumentClient source={{ kind: "licence", id }} />;
}

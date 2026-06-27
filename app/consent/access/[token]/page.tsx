import ConsentDocumentClient from "../../consent-document-client";

// PUBLIC consent document reached via a tokenised email link — no account needed.
export default async function ConsentTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ConsentDocumentClient source={{ kind: "token", token }} />;
}

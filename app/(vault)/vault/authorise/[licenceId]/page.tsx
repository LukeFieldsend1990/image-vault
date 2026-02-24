export const runtime = "edge";

import TalentAuthoriseClient from "./talent-authorise-client";

export default async function TalentAuthorisePage({ params }: { params: Promise<{ licenceId: string }> }) {
  const { licenceId } = await params;
  return <TalentAuthoriseClient licenceId={licenceId} />;
}

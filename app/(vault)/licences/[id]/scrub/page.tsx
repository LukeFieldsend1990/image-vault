export const runtime = "edge";

import ScrubAttestationClient from "./scrub-client";

export default async function LicenceScrubPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ScrubAttestationClient licenceId={id} />;
}

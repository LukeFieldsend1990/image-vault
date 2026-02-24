export const runtime = "edge";

import DualCustodyDownloadClient from "./dual-custody-client";

export default async function LicenceDownloadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DualCustodyDownloadClient licenceId={id} />;
}

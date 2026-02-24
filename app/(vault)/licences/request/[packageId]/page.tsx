export const runtime = "edge";

import LicenceRequestClient from "./licence-request-client";

export default async function LicenceRequestPage({ params }: { params: Promise<{ packageId: string }> }) {
  const { packageId } = await params;
  return <LicenceRequestClient packageId={packageId} />;
}

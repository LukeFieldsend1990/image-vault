export const runtime = "edge";

import CustodyClient from "./custody-client";

export default async function ChainOfCustodyPage({
  params,
}: {
  params: Promise<{ packageId: string }>;
}) {
  const { packageId } = await params;
  return <CustodyClient packageId={packageId} />;
}

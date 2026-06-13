export const runtime = "edge";

import VendorsClient from "./vendors-client";

export default async function LicenceVendorsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <VendorsClient licenceId={id} />;
}

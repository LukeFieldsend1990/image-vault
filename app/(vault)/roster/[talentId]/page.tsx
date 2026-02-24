export const runtime = "edge";

import RepVaultClient from "./rep-vault-client";

export default async function RepVaultPage({
  params,
}: {
  params: Promise<{ talentId: string }>;
}) {
  const { talentId } = await params;
  return <RepVaultClient talentId={talentId} />;
}

import LifetimeCustodyClient from "@/app/(vault)/vault/custody/lifetime-custody-client";

export const metadata = {
  title: "Chain of custody — ImageVault",
};

/**
 * The rep's view of a client's lifetime custody — the same component, pointed at
 * a specific performer. Authorisation is the API's job (`hasRepAccess`), which
 * is the pattern the rest of the roster follows; the page itself asserts
 * nothing it cannot verify.
 */
export default async function RosterLifetimeCustodyPage({
  params,
}: {
  params: Promise<{ talentId: string }>;
}) {
  const { talentId } = await params;
  return <LifetimeCustodyClient talentId={talentId} />;
}

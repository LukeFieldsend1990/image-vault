import LicencesClient from "./licences-client";

export default async function LicencesPage({
  searchParams,
}: {
  searchParams: Promise<{ highlight?: string }>;
}) {
  const { highlight } = await searchParams;
  return <LicencesClient highlight={highlight ?? null} />;
}

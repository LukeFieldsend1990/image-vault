import AddCountryClient from "./add-country-client";

export default async function AddCountryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AddCountryClient productionId={id} />;
}

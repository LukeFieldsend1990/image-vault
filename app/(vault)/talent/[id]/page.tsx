export const runtime = "edge";

import TalentProfileClient from "./talent-profile-client";

export default async function TalentProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TalentProfileClient talentId={id} />;
}

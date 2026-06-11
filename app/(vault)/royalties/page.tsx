export const runtime = "edge";

import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/serverSession";
import RoyaltiesClient from "./royalties-client";

export default async function RoyaltiesPage() {
  const session = await getServerSession();
  if (!session) redirect("/login?next=/royalties");
  // Licensees don't earn royalties; send them home.
  if (session.role === "licensee") redirect("/dashboard");
  return <RoyaltiesClient />;
}

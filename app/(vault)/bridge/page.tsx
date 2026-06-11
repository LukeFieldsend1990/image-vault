export const runtime = "edge";

import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/serverSession";
import BridgeClient from "./bridge-client";

export default async function BridgePage() {
  const session = await getServerSession();
  const role = session?.role ?? null;
  if (!role || (role !== "licensee" && role !== "talent" && role !== "rep" && role !== "admin")) {
    redirect("/dashboard");
  }
  return <BridgeClient role={role} />;
}

import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getDb } from "@/lib/db";
import { buildComplianceRolesOverview } from "@/lib/compliance/compliance-roles";
import ComplianceRolesClient from "./compliance-roles-client";

export default async function AdminComplianceRolesPage() {
  await requireAdmin();
  const overview = await buildComplianceRolesOverview(getDb());
  return <ComplianceRolesClient initial={overview} />;
}

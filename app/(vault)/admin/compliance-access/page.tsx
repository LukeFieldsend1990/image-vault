export const runtime = "edge";

import { requireAdmin } from "@/lib/auth/requireAdmin";
import ComplianceAccessClient from "./compliance-access-client";

export default async function AdminComplianceAccessPage() {
  await requireAdmin();
  return <ComplianceAccessClient />;
}

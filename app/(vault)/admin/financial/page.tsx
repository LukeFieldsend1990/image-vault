import { requireAdmin } from "@/lib/auth/requireAdmin";
import FinancialClient from "./financial-client";

export default async function AdminFinancialPage() {
  await requireAdmin();
  return <FinancialClient />;
}

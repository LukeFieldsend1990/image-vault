import { requireAdmin } from "@/lib/auth/requireAdmin";
import LedgerFailuresClient from "./ledger-failures-client";

export default async function LedgerFailuresPage() {
  await requireAdmin();
  return <LedgerFailuresClient />;
}

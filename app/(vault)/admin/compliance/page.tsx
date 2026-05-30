export const runtime = "edge";

import { requireAdmin } from "@/lib/auth/requireAdmin";
import AdminComplianceClient from "./compliance-client";

export default async function AdminCompliancePage() {
  await requireAdmin();
  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6">
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>
          Admin
        </p>
        <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>
          Compliance Console
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          SAG-AFTRA Article 39 — strike control, transfer escrow, certificate generation, ledger.
        </p>
      </div>
      <AdminComplianceClient />
    </div>
  );
}

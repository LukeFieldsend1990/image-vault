export const runtime = "edge";

import { requireAdmin } from "@/lib/auth/requireAdmin";
import AuditExportButton from "./export-button";
import { AuditEventTable } from "./audit-event-table";

export default async function AdminAuditPage() {
  await requireAdmin();

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6">
        <p
          className="text-[10px] uppercase tracking-widest font-semibold mb-1"
          style={{ color: "var(--color-accent)" }}
        >
          Admin
        </p>
        <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>
          Audit Log
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          Recent events across the platform.
        </p>
        <AuditExportButton showCategoryFilter />
      </div>

      <AuditEventTable />
    </div>
  );
}

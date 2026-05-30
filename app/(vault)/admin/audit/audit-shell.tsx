"use client";

import { useState } from "react";
import AuditExportButton from "./export-button";
import { AuditEventTable } from "./audit-event-table";

export interface AuditFilters {
  from: string;
  to: string;
  users: string;
  category: string;
}

export default function AuditShell() {
  const [filters, setFilters] = useState<AuditFilters>({
    from: "",
    to: "",
    users: "",
    category: "",
  });

  return (
    <>
      <AuditExportButton
        showCategoryFilter
        filters={filters}
        onFiltersChange={setFilters}
      />
      <AuditEventTable filters={filters} />
    </>
  );
}

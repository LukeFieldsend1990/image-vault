"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// Slim pointer shown at the top of /roster when a production has reserved
// roles for this agent. The actionable cards live on /vault/requests.
export default function RepReservedRolesBanner() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    fetch("/api/cast/rep-assignments")
      .then((r) => r.json() as Promise<{ assignments?: unknown[] }>)
      .then((d) => setCount(d.assignments?.length ?? 0))
      .catch(() => {});
  }, []);

  if (count === 0) return null;

  return (
    <div className="px-8 lg:px-12 pt-6">
      <Link
        href="/vault/requests"
        className="flex items-center justify-between gap-3 rounded border px-4 py-3 no-underline transition hover:opacity-80"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <span className="flex items-center gap-2.5 min-w-0">
          <span
            className="inline-block h-2 w-2 rounded-full shrink-0"
            style={{ background: "var(--color-accent)" }}
          />
          <span className="text-xs truncate" style={{ color: "var(--color-text)" }}>
            {count === 1
              ? "A production has reserved a role for one of your clients."
              : `Productions have reserved ${count} roles for your clients.`}
          </span>
        </span>
        <span
          className="text-xs font-medium shrink-0"
          style={{ color: "var(--color-accent)" }}
        >
          Review in Requests →
        </span>
      </Link>
    </div>
  );
}

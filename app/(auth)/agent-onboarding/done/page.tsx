"use client";

import Link from "next/link";
import { AgentShell } from "../shell";

/**
 * Step 5 — done. Lands the agent on the roster for now; the dedicated agent
 * inbox surface ships with gap #1, at which point this CTA points there.
 */
export default function AgentDonePage() {
  return (
    <AgentShell step={5} title="You're all set" subtitle="Your agent account is ready.">
      <div
        className="mb-8 rounded border px-4 py-4 text-sm"
        style={{ borderColor: "#166534", background: "rgba(22,101,52,0.06)", color: "#166534" }}
      >
        Password set, two-factor enabled, and terms accepted. Requests that need
        your decision will appear in your inbox once your agency starts receiving
        them.
      </div>

      <Link
        href="/roster"
        className="btn-accent block w-full px-4 py-3.5 text-center text-sm font-medium tracking-wide text-white transition"
      >
        Go to my roster
      </Link>
    </AgentShell>
  );
}

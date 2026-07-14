"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AgentShell } from "../shell";

/**
 * Step 4 of the agent arc — accept the agent terms. Reached after 2FA, so the
 * agent already holds a session. For the POC this is an acknowledgement gate;
 * durable, versioned signing is the remit of consent gap #3.
 */
export default function AgentTermsPage() {
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);

  return (
    <AgentShell
      step={4}
      title="Agent terms"
      subtitle="A few commitments before you start acting on behalf of performers."
    >
      <div
        className="mb-6 max-h-64 overflow-y-auto rounded border px-4 py-4 text-sm leading-relaxed"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)", color: "var(--color-muted)" }}
      >
        <p className="mb-3 text-[--color-ink] font-medium">As an agent on ImageVault, you agree that:</p>
        <ul className="space-y-2.5">
          <li>
            You act <strong className="text-[--color-ink]">on behalf of</strong> the performers your agency
            represents, in line with your mandate from them.
          </li>
          <li>
            You will only grant, refuse, forward, or counter a request within the
            authority you hold, and will forward to the performer when their
            standing instructions don&apos;t clearly cover it.
          </li>
          <li>
            Every decision you take is <strong className="text-[--color-ink]">audit-logged</strong> against
            your agent identity.
          </li>
          <li>
            You will keep your two-factor device secure and your account
            credentials confidential.
          </li>
        </ul>
      </div>

      <label className="mb-6 flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 accent-[--color-ink]"
        />
        <span className="text-sm text-[--color-ink]">
          I understand and accept these agent terms.
        </span>
      </label>

      <button
        type="button"
        disabled={!agreed}
        onClick={() => router.push("/agent-onboarding/done")}
        className="btn-accent w-full px-4 py-3.5 text-sm font-medium tracking-wide text-white transition disabled:opacity-50"
      >
        Accept and continue
      </button>
    </AgentShell>
  );
}

import { requireAdmin } from "@/lib/auth/requireAdmin";
import AdminRslClient from "./admin-rsl-client";
import OlpRequestsClient from "./olp-requests-client";
import AdminRslSettingsClient from "./admin-rsl-settings-client";
import AdminRslClientsClient from "./admin-rsl-clients-client";

export default async function AdminRslPage() {
  await requireAdmin();

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h2 className="text-base font-semibold mb-1" style={{ color: "var(--color-ink)" }}>OLP rail — kill switches</h2>
        <p className="text-sm mb-3" style={{ color: "var(--color-muted)" }}>Platform-wide master controls for AI licensing.</p>
        <AdminRslSettingsClient />
      </div>
      <h1 className="text-xl font-semibold mb-1" style={{ color: "var(--color-ink)" }}>RSL Consent Profiles</h1>
      <p className="text-sm mb-6" style={{ color: "var(--color-muted)" }}>
        The master switch for public-internet exposure. A talent&apos;s consent profile is served publicly only after
        you approve it here — approving mints the unlisted URL, revoking retires it. The stoplight is derived from the
        talent&apos;s own standing instructions; you control whether it&apos;s exposed, not what it says.
      </p>
      <AdminRslClient />

      <h2 className="text-base font-semibold mt-10 mb-1" style={{ color: "var(--color-ink)" }}>
        Open License Protocol requests
      </h2>
      <p className="text-sm mb-5" style={{ color: "var(--color-muted)" }}>
        Machine clients that asked to license a talent&apos;s likeness via the OLP endpoint. Prohibited usages are
        auto-denied and never appear; &ldquo;permitted with terms&rdquo; (amber) requests wait here for a decision.
        Granting issues the client an RSL licence token.
      </p>
      <OlpRequestsClient />

      <h2 className="text-base font-semibold mt-10 mb-1" style={{ color: "var(--color-ink)" }}>AI clients</h2>
      <p className="text-sm mb-5" style={{ color: "var(--color-muted)" }}>
        Machine clients that have licensed (or requested to license) a likeness. Verify a client, or block one to deny
        future requests and revoke its live metering keys.
      </p>
      <AdminRslClientsClient />
    </div>
  );
}

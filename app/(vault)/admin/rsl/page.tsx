import { requireAdmin } from "@/lib/auth/requireAdmin";
import AdminRslClient from "./admin-rsl-client";
import OlpRequestsClient from "./olp-requests-client";

export default async function AdminRslPage() {
  await requireAdmin();

  return (
    <div className="p-8 max-w-3xl">
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
    </div>
  );
}

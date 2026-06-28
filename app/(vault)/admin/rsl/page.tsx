import { requireAdmin } from "@/lib/auth/requireAdmin";
import AdminRslClient from "./admin-rsl-client";

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
    </div>
  );
}

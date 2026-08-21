import { requireAdmin } from "@/lib/auth/requireAdmin";
import ScoutAdminClient from "./scout-admin-client";

export const dynamic = "force-dynamic";

export default async function AdminScoutPage() {
  await requireAdmin();

  return (
    <div className="max-w-5xl mx-auto px-6 py-10 space-y-8">
      <div>
        <p className="text-xs font-medium tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
          Admin
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
          Image Scout trials
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
          Trial sweeps let rep and production accounts run the likeness monitor on any TMDB actor —
          a taste of the product before their talent is on the platform. Runs are capped per
          account; discovery spend still counts against the global Apify ceiling.
        </p>
      </div>
      <ScoutAdminClient />
    </div>
  );
}

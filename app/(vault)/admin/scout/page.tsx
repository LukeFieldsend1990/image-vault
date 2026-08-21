import Link from "next/link";
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

      {/* Admins run trials from their own account, uncapped and regardless of
          the toggle below — the fastest way to see exactly what a rep sees. */}
      <Link
        href="/scout"
        className="rounded p-4 flex items-center justify-between gap-4 transition hover:bg-black/[0.02]"
        style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)", display: "flex" }}
      >
        <div>
          <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
            Run a trial yourself
          </p>
          <p className="mt-1 text-xs" style={{ color: "var(--color-muted)" }}>
            Open Image Scout on your admin account — runs are not capped and work even while the
            feature is switched off for everyone else. Live discovery still spends against the
            Apify ceiling.
          </p>
        </div>
        <span className="text-sm shrink-0" style={{ color: "var(--color-accent)" }}>
          Open Image Scout →
        </span>
      </Link>

      <ScoutAdminClient />
    </div>
  );
}

import Link from "next/link";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import ApifyBudgetClient from "./apify-budget-client";
import WatchlistClient from "./watchlist-client";
import TakedownsClient from "./takedowns-client";
import FunnelCandidatesClient from "./funnel-candidates-client";
import CronClient from "./cron-client";
import PlatformsClient from "./platforms-client";
import VigilanceClient from "./vigilance-client";

export default async function AdminMonitorPage() {
  await requireAdmin();

  return (
    <div className="mx-auto max-w-4xl px-6 py-10 space-y-8">
      <div>
        <Link
          href="/admin"
          className="text-xs font-medium underline underline-offset-2"
          style={{ color: "var(--color-muted)" }}
        >
          ← Admin
        </Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
          Likeness Monitor — Discovery Spend
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
          Apify runs the platform sweeps that feed the likeness monitor. It bills per result, so spend is
          gated rather than merely reported.
        </p>
      </div>

      <CronClient />

      <hr style={{ borderColor: "var(--color-border)" }} />

      <VigilanceClient />

      <hr style={{ borderColor: "var(--color-border)" }} />

      <PlatformsClient />

      <hr style={{ borderColor: "var(--color-border)" }} />

      <ApifyBudgetClient />

      <hr style={{ borderColor: "var(--color-border)" }} />

      <TakedownsClient />

      <hr style={{ borderColor: "var(--color-border)" }} />

      <FunnelCandidatesClient />

      <hr style={{ borderColor: "var(--color-border)" }} />

      <WatchlistClient />
    </div>
  );
}

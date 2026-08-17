import Link from "next/link";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import ApifyBudgetClient from "./apify-budget-client";
import WatchlistClient from "./watchlist-client";
import TakedownsClient from "./takedowns-client";
import FunnelCandidatesClient from "./funnel-candidates-client";
import CronClient from "./cron-client";
import SweepsClient from "./sweeps-client";
import PlatformsClient from "./platforms-client";
import VigilanceClient from "./vigilance-client";
import CrossPlatformClient from "./cross-platform-client";
import LearnedQueriesClient from "./learned-queries-client";
import FeedbackClient from "./feedback-client";

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
          Likeness monitor
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
          Operational controls for the discovery sweeps: schedule, vigilance windows, platform coverage,
          Apify spend, the takedown backlog, and the shared account watchlist.
        </p>
      </div>

      <CronClient />

      <hr style={{ borderColor: "var(--color-border)" }} />

      <SweepsClient />

      <hr style={{ borderColor: "var(--color-border)" }} />

      <VigilanceClient />

      <hr style={{ borderColor: "var(--color-border)" }} />

      <PlatformsClient />

      <hr style={{ borderColor: "var(--color-border)" }} />

      <ApifyBudgetClient />

      <hr style={{ borderColor: "var(--color-border)" }} />

      <TakedownsClient />

      <hr style={{ borderColor: "var(--color-border)" }} />

      <FeedbackClient />

      <hr style={{ borderColor: "var(--color-border)" }} />

      <FunnelCandidatesClient />

      <hr style={{ borderColor: "var(--color-border)" }} />

      <WatchlistClient />

      <hr style={{ borderColor: "var(--color-border)" }} />

      <CrossPlatformClient />

      <hr style={{ borderColor: "var(--color-border)" }} />

      <LearnedQueriesClient />
    </div>
  );
}

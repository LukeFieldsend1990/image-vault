"use client";

import DeepfakeStatsPanel from "@/app/components/deepfake-stats-panel";

/**
 * The union/rep deepfake report at admin scope — platform-wide by default, or
 * narrowed to one union's affiliated members so an admin can see exactly what a
 * given union sees before answering a question about it.
 */
export default function AdminDeepfakeStatsClient() {
  return (
    <DeepfakeStatsPanel
      endpoint="/api/admin/monitor/deepfake-stats"
      title="Deepfake statistics"
      intro="Lifetime and month-to-date hit volume, growth, and the per-talent breakdown. Switch scope to read the same report a union watcher sees."
      variant="section"
    />
  );
}

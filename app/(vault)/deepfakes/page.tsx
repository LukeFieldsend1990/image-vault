import DeepfakeStatsPanel from "@/app/components/deepfake-stats-panel";

// Union deepfake statistics. Access is enforced by the API (a union watcher's
// platform- or union-scoped union grant, or admin); the nav only surfaces this
// to union watchers, since a platform-wide regulator has no union to report on.
export default function UnionDeepfakeStatsPage() {
  return (
    <div className="p-8 max-w-5xl">
      <DeepfakeStatsPanel
        endpoint="/api/compliance/union/deepfake-stats"
        eyebrow="Union"
        title="Deepfake Statistics"
        intro="Synthetic-likeness hits recorded against your members by Deep Scan — lifetime, this month, and how fast it is moving."
      />
    </div>
  );
}

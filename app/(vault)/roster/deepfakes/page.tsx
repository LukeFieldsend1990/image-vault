import DeepfakeStatsPanel from "@/app/components/deepfake-stats-panel";

// Rep roster deepfake statistics. Counts only; hit detail stays on
// /roster/monitor, which applies the rep privacy sanitisation.
export default function RosterDeepfakeStatsPage() {
  return (
    <div className="p-8 max-w-5xl">
      <DeepfakeStatsPanel
        endpoint="/api/roster/deepfake-stats"
        eyebrow="Representative"
        title="Deepfake Statistics"
        intro="Synthetic-likeness hits recorded against your clients by Deep Scan — lifetime, this month, and how fast it is moving."
        backHref="/roster/monitor"
        backLabel="← Deep Scan"
      />
    </div>
  );
}

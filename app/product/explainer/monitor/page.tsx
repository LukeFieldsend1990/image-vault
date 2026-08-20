import type { Metadata } from "next";
import ExplainerStandalone from "../explainer-standalone";

export const metadata: Metadata = {
  title: "The Likeness Monitor — the vault that watches back",
  description:
    "The Likeness Monitor explainer: deepfakes detected against the ground-truth scan data only the vault holds — five independent signals, event-aware sweeps, and evidence ready to send.",
};

export default function MonitorExplainerPage() {
  return (
    <ExplainerStandalone
      src="/explainer/imagevault-likeness-monitor.html?v=3"
      filmTitle="The Likeness Monitor — the vault that watches back"
      backHref="/product/likeness-monitor"
    />
  );
}

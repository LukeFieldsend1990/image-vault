import type { Metadata } from "next";
import ExplainerStandalone from "../explainer-standalone";

export const metadata: Metadata = {
  title: "Deep Scan — the vault that looks out for you",
  description:
    "Deep Scan explainer: deepfakes detected against the ground-truth scan data only the vault holds — five independent signals, event-aware sweeps, and evidence ready to send.",
};

export default function MonitorExplainerPage() {
  return (
    <ExplainerStandalone
      src="/explainer/imagevault-likeness-monitor.html?v=6"
      filmTitle="Deep Scan — the vault that looks out for you"
      backHref="/product/deep-scan"
    />
  );
}

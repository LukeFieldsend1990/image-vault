import type { Metadata } from "next";
import ExplainerStandalone from "./explainer-standalone";

export const metadata: Metadata = {
  title: "What ImageVault does — the explainer",
  description:
    "A ninety-second tour of ImageVault: one vault for an actor's likeness, licensed on their terms with dual-custody release and a tamper-evident record.",
};

export default function ExplainerPage() {
  return <ExplainerStandalone />;
}

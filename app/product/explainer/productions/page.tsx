import type { Metadata } from "next";
import ExplainerStandalone from "../explainer-standalone";

export const metadata: Metadata = {
  title: "What ImageVault does — for productions",
  description:
    "The production-focused cut of the ImageVault explainer: the performer data your production captures, sealed in one vault and released to vendors through the Bridge — provable, auditable, deletable.",
};

export default function ProductionsExplainerPage() {
  return (
    <ExplainerStandalone
      src="/explainer/imagevault-explainer-productions.html"
      filmTitle="What ImageVault does — for productions"
    />
  );
}

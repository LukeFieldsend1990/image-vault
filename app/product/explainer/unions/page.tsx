import type { Metadata } from "next";
import ExplainerStandalone from "../explainer-standalone";

export const metadata: Metadata = {
  title: "What ImageVault does — for performers' unions",
  description:
    "The union-focused cut of the ImageVault explainer: scattered member likenesses gathered into one vault, licensed on terms the member sets, with consent, expiry, reuse and compliance all on the record.",
};

export default function UnionsExplainerPage() {
  return (
    <ExplainerStandalone
      src="/explainer/imagevault-explainer-unions.html"
      filmTitle="What ImageVault does — for performers' unions"
    />
  );
}

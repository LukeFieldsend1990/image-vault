import type { Metadata } from "next";
import ExplainerStandalone from "../explainer-standalone";

export const metadata: Metadata = {
  title: "The Likeness Monitor — launch trailer",
  description:
    "The launch trailer for the Likeness Monitor: deepfake detection anchored to the sealed originals only the vault holds. Ninety seconds, no fine print.",
};

export default function DetectorTrailerPage() {
  return (
    <ExplainerStandalone
      src="/explainer/imagevault-detector-trailer.html?v=2"
      filmTitle="The Likeness Monitor — launch trailer"
      backHref="/product/likeness-monitor"
    />
  );
}

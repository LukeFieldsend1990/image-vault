import type { Metadata } from "next";
import ExplainerStandalone from "../explainer-standalone";

export const metadata: Metadata = {
  title: "Deep Scan — launch trailer",
  description:
    "The launch trailer for Deep Scan: deepfake detection anchored to the sealed originals only the vault holds. A hundred seconds, no fine print.",
};

export default function DetectorTrailerPage() {
  return (
    <ExplainerStandalone
      src="/explainer/imagevault-detector-trailer.html?v=7"
      filmTitle="Deep Scan — launch trailer"
      backHref="/product/deep-scan"
    />
  );
}

import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // The Likeness Monitor relaunched as Deep Scan; old links stay live.
      {
        source: "/product/likeness-monitor",
        destination: "/product/deep-scan",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;

// Wire up Cloudflare bindings (D1, KV, R2, Queues, etc.) when running `next dev`.
// Guarded to the dev server only: during `next build` there is no local
// platform to proxy, and invoking it would attempt a remote binding session.
if (process.env.NODE_ENV === "development") {
  initOpenNextCloudflareForDev();
}

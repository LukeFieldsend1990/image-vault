import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for Cloudflare Pages / next-on-pages
  // All route handlers must use edge runtime
};

// Wire up Cloudflare bindings (D1, KV, R2) when running `next dev`.
// Dynamic import avoids top-level await which breaks require()-based config loading.
// The platform initialises before any request arrives so no race condition in practice.
if (process.env.NODE_ENV === "development") {
  void import("@cloudflare/next-on-pages/next-dev").then(({ setupDevPlatform }) =>
    setupDevPlatform()
  );
}

export default nextConfig;

import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {};

export default nextConfig;

// Wire up Cloudflare bindings (D1, KV, R2, Queues, etc.) when running `next dev`.
// Guarded to the dev server only: during `next build` there is no local
// platform to proxy, and invoking it would attempt a remote binding session.
//
// `getPlatformProxy` enables remote bindings by default, and wrangler.toml
// declares several that Miniflare cannot simulate (Workers AI, Vectorize, and
// the AI_SERVICE / AI_CRON_SERVICE service bindings). It therefore opens a
// remote proxy session on startup — and with no Cloudflare credentials that
// throws, so `next dev` refuses to start at all. Not just for those bindings:
// for everything, including D1 and KV, which simulate locally perfectly well.
//
// So remote bindings are enabled only when there is a token to use. Without one
// the dev server runs fully local: D1, KV, R2 and Queues through Miniflare, with
// AI and Vectorize unavailable. That is the correct trade for a machine that
// cannot reach Cloudflare, and it is the difference between a working dev server
// and none.
if (process.env.NODE_ENV === "development") {
  const canReachCloudflare = Boolean(process.env.CLOUDFLARE_API_TOKEN);
  initOpenNextCloudflareForDev(canReachCloudflare ? undefined : { remoteBindings: false });
}

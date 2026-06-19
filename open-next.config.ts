import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Default configuration: routes render on demand in the Worker.
// No incremental (ISR) cache is configured yet — the app is almost entirely
// dynamic SSR, so this is a safe starting point. To enable ISR/SSG caching
// later, add an incremental cache (e.g. R2) here:
//   import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
//   export default defineCloudflareConfig({ incrementalCache: r2IncrementalCache });
// See https://opennext.js.org/cloudflare/caching
export default defineCloudflareConfig();

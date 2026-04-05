/**
 * KV-based rate limiter for Cloudflare Edge.
 *
 * Sliding-window counter keyed by IP + action.
 * Returns { ok, remaining, retryAfterSeconds }.
 */
import { getRequestContext } from "@cloudflare/next-on-pages";

interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface RateLimitOptions {
  /** Unique action name, e.g. "login" or "2fa" */
  action: string;
  /** Max attempts within the window */
  maxAttempts: number;
  /** Window duration in seconds */
  windowSeconds: number;
}

interface RateLimitBucket {
  count: number;
  /** Unix epoch seconds when window started */
  windowStart: number;
}

export async function checkRateLimit(
  ip: string,
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  const kv = getRequestContext().env.SESSIONS_KV;
  const key = `rl:${opts.action}:${ip}`;
  const now = Math.floor(Date.now() / 1000);

  const raw = await kv.get(key);
  let bucket: RateLimitBucket;

  if (raw) {
    bucket = JSON.parse(raw) as RateLimitBucket;
    // Window expired — reset
    if (now - bucket.windowStart >= opts.windowSeconds) {
      bucket = { count: 0, windowStart: now };
    }
  } else {
    bucket = { count: 0, windowStart: now };
  }

  bucket.count += 1;

  const remaining = Math.max(0, opts.maxAttempts - bucket.count);
  const ttl = opts.windowSeconds - (now - bucket.windowStart);

  // Always write updated count (even if over limit, so counter stays accurate)
  await kv.put(key, JSON.stringify(bucket), { expirationTtl: opts.windowSeconds });

  if (bucket.count > opts.maxAttempts) {
    return { ok: false, remaining: 0, retryAfterSeconds: ttl };
  }

  return { ok: true, remaining, retryAfterSeconds: 0 };
}

export function getClientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

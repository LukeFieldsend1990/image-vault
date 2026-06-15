// Approximate, display-only model of the render-bridge's offline purge grace.
//
// The real 48h window is enforced *inside* the bridge container, anchored on its
// own `lastSuccessfulGrantAt` (the last 2xx/404 from GET …/project-grant). That
// anchor is never reported to the platform, so the closest proxy we have is
// `lastHeartbeatAt`: heartbeat and grant-fetch fire in the same ~30s cycle over
// the same network, so they go stale together — drift is at most one cycle.
//
// This module is therefore an ESTIMATE for UI only, never an enforcement gate.
// It deliberately suppresses the countdown for states where the bridge purges
// *immediately* rather than after the grace window (revoked agent, or a server-
// directed `purge` pending) — showing "48h remaining" there would be wrong.

/** Matches the admin/licensee "online" threshold: a heartbeat within 60s. */
export const ONLINE_THRESHOLD_SECS = 60;

/** Mirrors the bridge default CASBRIDGE_OFFLINE_GRACE_HOURS (48h). */
export const OFFLINE_GRACE_SECS = 48 * 3600;

export type PurgeGraceState =
  /** Heartbeat is fresh; nothing counting down. */
  | { kind: "online" }
  /** No countdown applies: never enrolled, revoked, or an immediate purge is pending. */
  | { kind: "none" }
  /** Offline and within the grace window — files still on the share. */
  | { kind: "counting"; deadlineUnix: number; secondsRemaining: number }
  /** Offline past the grace window — the bridge has almost certainly purged. */
  | { kind: "elapsed"; deadlineUnix: number };

export function computePurgeGrace(params: {
  lastHeartbeatAt: number | null;
  revoked: boolean;
  pendingAction: string | null;
  now: number;
}): PurgeGraceState {
  const { lastHeartbeatAt, revoked, pendingAction, now } = params;

  // Immediate-purge / terminal states never show a 48h countdown.
  if (revoked || pendingAction === "purge") return { kind: "none" };
  // Never heart-beat → never synced anything to purge.
  if (lastHeartbeatAt === null) return { kind: "none" };

  if (lastHeartbeatAt > now - ONLINE_THRESHOLD_SECS) return { kind: "online" };

  const deadlineUnix = lastHeartbeatAt + OFFLINE_GRACE_SECS;
  const secondsRemaining = deadlineUnix - now;
  if (secondsRemaining <= 0) return { kind: "elapsed", deadlineUnix };
  return { kind: "counting", deadlineUnix, secondsRemaining };
}

/** Compact "47h 12m" / "1d 3h" / "8m" style duration for a countdown. */
export function formatGraceRemaining(secondsRemaining: number): string {
  const s = Math.max(0, secondsRemaining);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m`;
  return "< 1m";
}

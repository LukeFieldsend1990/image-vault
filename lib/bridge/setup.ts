// Shared constants + types for the guided Bridge setup flow. Imported by both the
// server (attestation route, settings page) and the client checklist so the
// statement wording and versions never drift.

export const RENDER_BRIDGE_IMAGE = "ghcr.io/lukefieldsend1990/render-bridge:latest";

export type BridgeAttestationKind = "local_access" | "bridge_live";

// Bump the version when the wording changes, so we can always prove which
// statement a vendor signed at attestation time.
export const STATEMENT_VERSIONS: Record<BridgeAttestationKind, string> = {
  local_access: "local_access_v1",
  bridge_live: "bridge_live_v1",
};

// What the vendor must put in place on their own network before attesting step 3.
export const LOCAL_ACCESS_RULES = [
  "The Bridge folder exists at a path your artists can reach.",
  "Only authorised workstations can read or write to it.",
  "The folder is excluded from render-farm crawlers and indexing.",
  "No backups, mirrors, or other secondary copies are made from the Bridge folder.",
];

// The final go-live attestation bullets.
export const BRIDGE_LIVE_STATEMENTS = [
  "The Bridge agent is running on a machine you control.",
  "Local access has been configured to the rules in step 3.",
  "The Bridge folder is excluded from render-farm and indexing systems.",
];

// Server-computed snapshot of where the primary org is in guided setup.
export interface BridgeSetupStatus {
  orgId: string;
  orgName: string;
  orgShortCode: string | null;
  hasToken: boolean;
  agentEnrolled: boolean;
  agentOnline: boolean;
  localAttested: boolean;
  liveAttested: boolean;
  liveAttestedAt: number | null;
}

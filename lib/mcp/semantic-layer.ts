/**
 * Semantic layer for the admin MCP integration.
 *
 * A curated map of the platform's concepts so an MCP client (Claude) can
 * orient itself before acting. Compiled from the "Image Vault concepts"
 * Notion workspace docs and the codebase. Exposed via the list_concepts and
 * explain_concept tools.
 *
 * Keep entries short and factual; this is a navigation aid, not prose docs.
 */

export interface ConceptEntry {
  id: string;
  name: string;
  summary: string;
  details: string;
  codePaths: string[];
  related: string[];
}

export const CONCEPTS: ConceptEntry[] = [
  {
    id: "product-overview",
    name: "Product Overview",
    summary: "Secure biometric likeness archive for actors: talent stores scan packages and licenses access to production companies.",
    details:
      "Image Vault (live at changling.io) is trust + rights infrastructure for AI-native production: Registry → Identity → Licensing → Provenance. " +
      "Talent uploads scan packages (light stage, photogrammetry, LiDAR…), production companies request licences, and downloads are released only " +
      "through a dual-custody 2FA gate. Pillars: Consent OS, Chain of Custody, Dual-Custody Access, Compliance Surface (SAG-AFTRA 2026 Article 39), Rights Infrastructure.",
    codePaths: ["app/", "lib/"],
    related: ["security-model", "licensing-lifecycle", "roles-permissions"],
  },
  {
    id: "security-model",
    name: "Security & Encryption Model",
    summary: "Managed encryption + dual-custody access. NOT zero-knowledge — the client-side encryption model was deprecated and is not pursued.",
    details:
      "Current model: server-mediated uploads (Worker-buffered multipart, presigned direct-to-R2 for large packages); AES-256 at rest in R2; TLS 1.3 in transit; " +
      "bridge manifests signed with P-256 ECDSA; tamper-evident hash-chained audit ledger. Dual-custody: both licensee AND talent/rep must complete 2FA before a " +
      "download token is issued — no single party can release a likeness alone. Zero-knowledge / client-side key custody was deliberately dropped (a forgotten " +
      "passphrase would mean permanent loss of an irreplaceable 1 TB asset); some scaffolding remains in lib/crypto/ but is out of scope. " +
      "Recovery direction is Shamir 2-of-3 split-key (talent / agency / platform), not client-side keys.",
    codePaths: ["lib/crypto/ (legacy scaffolding)", "lib/auth/"],
    related: ["download-dual-custody", "auth-sessions-2fa", "audit-log"],
  },
  {
    id: "roles-permissions",
    name: "Roles & Permissions",
    summary: "Four roles on users.role: talent, rep, licensee, admin. Admin is a hardcoded email whitelist, not a grantable role.",
    details:
      "talent: upload scans, approve/deny licences, invite reps + licensees, set vault lock, licence permissions, pipeline & royalty config. " +
      "rep: view managed talent's licences, act on their behalf (delegation). licensee: request licences, initiate downloads, royalty sources, compliance attestations. " +
      "admin: everything — whitelist-only in lib/auth/adminEmails.ts, changed by code commit (deliberately not env-backed so a compromised Cloudflare login cannot escalate). " +
      "Feature gating: talentLicencePermissions per talent × licence type (allowed | approval_required | blocked) and per-user flags " +
      "(vaultLocked, suspendedAt, emailMuted, aiDisabled, inboundEnabled, geoFingerprintEnabled, royaltyMeterEnabled, complianceEnabled). " +
      "Org membership roles: owner | admin | member.",
    codePaths: ["lib/auth/adminEmails.ts", "lib/db/schema.ts (users)"],
    related: ["auth-sessions-2fa", "admin-panel"],
  },
  {
    id: "auth-sessions-2fa",
    name: "Auth, Sessions & 2FA",
    summary: "Password login → mandatory TOTP 2FA → short-lived session JWT + 7-day rotating refresh token.",
    details:
      "Session JWT signed HS256 with JWT_SECRET (issuer image-vault, audience image-vault-app); refresh tokens hashed in refreshTokens and rotated via /api/auth/refresh. " +
      "TOTP via otpauth (SHA1, 6 digits, 30s period, ±1 window), secrets in totpCredentials, enrolment at /setup-2fa. " +
      "Guards: requireSession (cookie JWT → SessionPayload {sub, email, role}), requireAdmin (server components), requireBridgeToken / requireMcpToken (bearer tokens, SHA-256 hashed in DB). " +
      "KV-based sliding-window rate limiting in lib/auth/rateLimit.ts.",
    codePaths: ["lib/auth/", "app/api/auth/", "app/(auth)/"],
    related: ["roles-permissions", "mcp-admin-integration"],
  },
  {
    id: "licensing-lifecycle",
    name: "Licensing Lifecycle",
    summary: "Licences move through AWAITING_PACKAGE → PENDING → APPROVED/DENIED → REVOKED/EXPIRED → SCRUB_PERIOD → CLOSED/OVERDUE.",
    details:
      "A licence ties talentId + packageId + licenseeId with project, production company, intended use, validity window, territory, exclusivity and fees " +
      "(proposedFee/agreedFee/platformFee in cents; platform fee 15%). Licence types: film_double, game_character, commercial, ai_avatar, training_data, monitoring_reference. " +
      "After expiry, licensees enter SCRUB_PERIOD and must attest deletion (admin /admin/scrub tracks OVERDUE). deliveryMode standard | bridge_only.",
    codePaths: ["lib/db/schema.ts (licences)", "app/api/licences/"],
    related: ["download-dual-custody", "vault-packages", "render-bridge"],
  },
  {
    id: "vault-packages",
    name: "Vault & Scan Packages",
    summary: "Scan packages (metadata + files in R2) with soft delete, enrichment metadata, and a processing pipeline.",
    details:
      "scanPackages holds metadata (scan type, resolution, polygon count, mesh/texture/HDR/mocap flags, engine compatibility, tags) and status uploading | ready | error; " +
      "scanFiles tracks per-file R2 keys, sizes and SHA-256. Soft delete via deletedAt/deletedBy — admins can restore. Uploads are Worker-buffered multipart with a " +
      "presigned direct-to-R2 path for very large packages. pipeline-worker processes packages: validate → classify → assemble → bundle.",
    codePaths: ["lib/db/schema.ts (scanPackages, scanFiles)", "app/api/vault/", "pipeline-worker/"],
    related: ["licensing-lifecycle", "security-model"],
  },
  {
    id: "download-dual-custody",
    name: "Download & Dual-Custody",
    summary: "Both the licensee and the talent/rep must complete 2FA before a download token is issued; no single party can release a likeness.",
    details:
      "Downloads are token-gated and time-boxed via accessWindows (maxDownloads, expiry). Talent can pre-authorise with proactive TOTP. " +
      "Every download is recorded in downloadEvents (ip, userAgent, bytes). This gate is the structural protection that replaced the deprecated zero-knowledge design.",
    codePaths: ["app/api/licences/", "lib/db/schema.ts (accessWindows, downloadEvents)"],
    related: ["security-model", "licensing-lifecycle", "audit-log"],
  },
  {
    id: "render-bridge",
    name: "Render Bridge",
    summary: "Desktop/render-farm agent that uses likeness data under signed, revocable grants instead of raw downloads.",
    details:
      "bridgeGrants carry a P-256-signed manifest scoping package, tool and device, with expiry + 48h offline grace and remote purge. " +
      "bridgeEvents logs tamper_detected, hash_mismatch, cache_purged, purge lifecycle etc. with severity info|warn|critical. " +
      "Bearer bridge tokens (brt_, SHA-256 hashed in bridgeTokens) authenticate agents; admin console at /admin/bridge.",
    codePaths: ["app/api/bridge/", "lib/auth/requireBridgeToken.ts"],
    related: ["download-dual-custody", "audit-log"],
  },
  {
    id: "admin-panel",
    name: "Admin Panel",
    summary: "Console at /admin for platform operations: users, packages, licences, bridge, AI, audit, compliance, scrub, skills, productions, orgs.",
    details:
      "Access restricted to the email whitelist (middleware + requireAdmin()). Users: role switcher (cannot assign admin) and per-user feature toggles. " +
      "Packages: includes soft-deleted with restore, cross-account cloning. Licences: full table including AWAITING_PACKAGE placeholders. " +
      "Bridge: agent table + event log. AI: batch runs, call log, per-user toggles. Audit: unified filterable event stream with CSV export. " +
      "Compliance: per-org dashboards + certificates. Scrub: deletion attestation tracking. Skills: triage skill catalogue. Also: demo mode toggle.",
    codePaths: ["app/(vault)/admin/", "app/api/admin/"],
    related: ["roles-permissions", "audit-log", "mcp-admin-integration"],
  },
  {
    id: "ai-infrastructure",
    name: "AI Infrastructure",
    summary: "callAi() orchestrator with Anthropic Haiku primary and Workers AI Llama fallback, cost tracking and a $1.00 rolling 14-day budget.",
    details:
      "Every call logged to aiCostLog (provider, model, feature, tokens, estimated cost, prompt/response); checkBudget() enforces the ceiling; " +
      "isAiEnabled(db, feature) checks aiSettings flags; requiresReasoning routes to Anthropic. Features: email triage, suggestions (ai-cron-worker batches), " +
      "security alerts, package tag enrichment, semantic package search (Vectorize). Inbound email is treated as untrusted (prompt-injection guarded).",
    codePaths: ["lib/ai/", "ai-worker/", "ai-cron-worker/", "lib/inbound/triage.ts"],
    related: ["audit-log", "admin-panel"],
  },
  {
    id: "audit-log",
    name: "Audit Log",
    summary: "Unified admin event stream assembled from downloads, bridge events, grants, licences, signups, packages, invites and password resets.",
    details:
      "/api/admin/audit/events composes events with category, actor, severity (info|warn|critical) and supports date/user/category filters + CSV export. " +
      "complianceEvents adds a hash-chained, append-only consent ledger. MCP tool calls are additionally logged to mcpAuditLog.",
    codePaths: ["app/api/admin/audit/", "lib/db/schema.ts (downloadEvents, bridgeEvents, complianceEvents, mcpAuditLog)"],
    related: ["admin-panel", "security-model"],
  },
  {
    id: "data-model",
    name: "Data Model",
    summary: "Single-file Drizzle schema (40+ D1/SQLite tables): users, packages, licences, bridge, AI, compliance, productions, organisations.",
    details:
      "Conventions: UUIDv4 ids, UNIX-epoch-second integer timestamps, 0/1 integer booleans, JSON stored in text columns and parsed manually. " +
      "Key clusters — identity: users, totpCredentials, refreshTokens, invites; vault: scanPackages, scanFiles, uploadSessions; licensing: licences, " +
      "talentLicencePermissions, accessWindows, downloadEvents; bridge: bridgeTokens, bridgeDevices, bridgeGrants, bridgeEvents; AI: aiSettings, aiCostLog, " +
      "aiBatchRuns, suggestions, packageTags; MCP: mcpTokens, mcpAuditLog. Migrations are sequential SQL in drizzle/migrations/.",
    codePaths: ["lib/db/schema.ts", "drizzle/migrations/"],
    related: ["api-conventions"],
  },
  {
    id: "api-conventions",
    name: "Runtime & API Conventions",
    summary: "~171 API routes across ~22 domain groups; routes run on the Cloudflare Workers (Node.js-compatible) runtime via OpenNext and guard with requireSession or a token guard.",
    details:
      "Next.js App Router on Cloudflare Workers (@opennextjs/cloudflare) — Node.js-compatible runtime (nodejs_compat). Standard shape: requireSession → isErrorResponse check → " +
      "await params (Promise in Next 15+) → getDb() → role checks → query. Admin checks via isAdmin(session.email). Fire-and-forget async via void IIFE or ctx.waitUntil(). " +
      "Bindings: D1 (DB), KV (SESSIONS_KV), R2 (SCANS_BUCKET, PIPELINE_BUCKET), Queues, Workers AI, Vectorize.",
    codePaths: ["app/api/", "lib/auth/requireSession.ts", "lib/db/index.ts"],
    related: ["data-model", "auth-sessions-2fa"],
  },
  {
    id: "tmdb-cast-suggestions",
    name: "TMDB Cast Suggestion & Population Flow",
    summary: "Three MCP tools that use the TMDB API to suggest cast for a production and bulk-populate the cast list, then outreach rep agencies for unlinked actors.",
    details:
      "Flow: (1) suggest_production_cast — given a production with a tmdbId, fetches TMDB /movie or /tv credits and cross-references " +
      "talentProfiles.tmdbId to show platformStatus per actor: 'registered' (matched in system), 'on_cast' (already added), or 'not_on_platform'. " +
      "(2) populate_cast_from_tmdb — takes selected actors from the suggestion; registered talent get an AWAITING_PACKAGE licence + linked cast row + email; " +
      "others become placeholder rows with licenceTermsJson stored for later. " +
      "(3) outreach_unlinked_cast — for placeholder rows, looks up reps linked to talent with the same TMDB ID (specific outreach), " +
      "or falls back to emailing all rep users in the system, asking 'do you represent [actor]?' so the connection can be established. " +
      "After a rep confirms, resolve_cast_member attaches an email and issues an invite. " +
      "Requires TMDB_API_KEY env secret. Production must have tmdbId set before suggest_production_cast will work.",
    codePaths: ["lib/mcp/tools/tmdb-cast.ts", "lib/email/templates.ts (repRepresentationEnquiryEmail)"],
    related: ["product-overview", "licensing-lifecycle", "mcp-admin-integration"],
  },
  {
    id: "mcp-admin-integration",
    name: "Admin MCP Integration",
    summary: "This integration: an MCP server at /api/mcp giving whitelisted admins visibility and corrective tools over the platform.",
    details:
      "Bearer tokens (mcp_, SHA-256 hashed in mcpTokens, expiring, revocable) are minted at /admin/mcp by an authenticated admin presenting a fresh TOTP code. " +
      "Scopes: read (visibility tools) and admin (corrective tools). Every mutating tool call additionally requires a live TOTP code, verified per call — " +
      "the MCP analogue of dual-custody. The admin whitelist is re-checked on every request, so removing an email kills its tokens. " +
      "All calls are rate-limited and logged to mcpAuditLog with TOTP codes redacted. Tools live in lib/mcp/tools/ and self-register, mirroring lib/skills/.",
    codePaths: ["app/api/mcp/", "lib/mcp/", "lib/auth/requireMcpToken.ts", "app/(vault)/admin/mcp/"],
    related: ["admin-panel", "auth-sessions-2fa", "security-model"],
  },
];

export function getConcept(id: string): ConceptEntry | undefined {
  return CONCEPTS.find((c) => c.id === id);
}

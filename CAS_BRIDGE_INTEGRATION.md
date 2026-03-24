# CAS Bridge — Web App Integration Spec

> **For web-app agents.** This document describes the full contract between the
> Image Vault web app and the CAS Bridge desktop application. All web-side
> endpoints are already implemented on the `api-bridge` branch. The bridge app
> lives at [github.com/LukeFieldsend1990/changling-vault-bridge](https://github.com/LukeFieldsend1990/changling-vault-bridge).

---

## 1. What is the CAS Bridge?

The CAS Bridge is a macOS menu-bar application written in Swift that runs
locally on a licensee's workstation. It acts as a custody-aware proxy between
DCC tools (Nuke, Houdini, Maya, Blender, Unreal) and the Image Vault platform.

**Core responsibilities:**

- Authenticate to the Image Vault API with a long-lived Personal Access Token (PAT)
- Request a signed "grant manifest" for a licensed scan package
- Download and cache the package files locally
- Enforce licence constraints in-process (allowed tools, expiry, device binding)
- Poll the API to detect revocation or vault-lock in near-real-time
- Report integrity events back to the platform (tamper, hash mismatch, unexpected copy, etc.)

The bridge never bypasses the web app's access control — every open request is
validated server-side against the licence, vault-lock state, and allowed-tools
matrix.

---

## 2. Authentication Model

### 2.1 Personal Access Tokens (PAT)

The bridge authenticates with a PAT, not a session cookie. PATs are created and
managed by the licensee in **Settings → Bridge** (`/settings/bridge`).

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/bridge/tokens` | GET | Session cookie | List caller's tokens (hash never returned) |
| `/api/bridge/tokens` | POST | Session cookie | Create token — raw value returned once |
| `/api/bridge/tokens/[id]` | DELETE | Session cookie | Revoke a token |

PAT wire format: `Authorization: Bearer brt_<64 hex chars>`

Server-side: the raw token is never stored. Only `sha256(token)` is persisted in
`bridge_tokens` (D1). `requireBridgeToken` hashes the incoming header and
looks up the hash.

### 2.2 Device Registration

Before requesting a grant manifest, the bridge registers its device fingerprint.
Device IDs are stable per machine (derived from hardware identifiers in Swift).

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/bridge/devices` | GET | PAT | List registered devices for caller's account |
| `/api/bridge/devices` | POST | PAT | Register (or update) a device by fingerprint |

POST body:
```json
{ "fingerprint": "<hardware-derived UUID>", "displayName": "MacBook Pro (Luke)" }
```

Response: `{ "id": "<uuid>", "registered": true }` (201 on first insert, 200 on
upsert).

---

## 3. Grant Manifest Flow

This is the core DRM flow. The bridge calls this when a licensee opens a package
inside a DCC tool.

### 3.1 Request a grant

```
POST /api/bridge/packages/:packageId/open
Authorization: Bearer brt_...
Content-Type: application/json

{
  "licenceId": "<uuid>",
  "deviceId": "<registered device uuid>",
  "tool": "nuke"
}
```

**Server-side validation (in order):**

1. PAT → resolve `userId` (licensee's user ID)
2. Licence exists, belongs to this licensee, covers this packageId
3. Licence status is `APPROVED`
4. Licence has not expired (`validTo > now`)
5. Talent's vault is not locked
6. `tool` is permitted for `licenceType` (see matrix below)
7. Files exist in the package with `uploadStatus = 'complete'`
8. File scope is applied (`fileScope` on the licence — can be `"all"` or JSON array of fileIds)

**Tool × LicenceType permission matrix:**

| licenceType | Allowed tools |
|---|---|
| `film_double` | nuke, houdini, maya |
| `game_character` | houdini, unreal, blender |
| `commercial` | nuke, houdini, maya, blender |
| `ai_avatar` | nuke |
| `training_data` | _(none — no DCC access)_ |
| `monitoring_reference` | nuke |

**Success response (200):**

```json
{
  "grantId": "<uuid>",
  "manifest": "<JSON string>",
  "signature": "<base64url ECDSA-P256 signature over manifest>",
  "keyId": "bridge-signing-key-1"
}
```

The manifest JSON (before stringification):

```json
{
  "version": "1",
  "grantId": "<uuid>",
  "packageId": "<uuid>",
  "licenceId": "<uuid>",
  "allowedTools": ["nuke"],
  "allowedUserIds": ["<licensee userId>"],
  "allowedDeviceIds": ["<deviceId>"],
  "expiresAt": 1234567890,
  "offlineUntil": 1234567890,
  "files": [
    {
      "fileId": "<uuid>",
      "filename": "body_scan.exr",
      "path": "body_scan.exr",
      "size": 12345678,
      "sha256": "<hex or null>",
      "sourceUrl": "<presigned R2 GET URL, valid 24h>"
    }
  ]
}
```

- `expiresAt` = `licence.validTo` (Unix seconds)
- `offlineUntil` = `expiresAt + 48h` (grace period for offline use)
- `sourceUrl` is a 24-hour presigned R2 GET URL. The bridge downloads files
  locally and uses the cached copy. It re-fetches a new manifest (and thus new
  URLs) before the 24h window closes.

**The grant is recorded in D1** (`bridge_grants` table) for audit and revocation.

### 3.2 Error responses

| Status | Meaning |
|---|---|
| 401 | Invalid or revoked PAT |
| 403 | Licence belongs to different user / tool not permitted |
| 404 | Licence or package not found / no completed files |
| 409 | Licence not approved or expired |
| 423 | Vault is locked |
| 503 | `BRIDGE_SIGNING_KEY_JWK` secret not set |

---

## 4. Status Polling

The bridge polls this endpoint periodically (recommended: every 5 minutes when
online) to detect revocation.

```
GET /api/bridge/packages/:packageId/status?grantId=<uuid>
Authorization: Bearer brt_...
```

Response:

```json
{
  "grantId": "<uuid>",
  "status": "active",
  "tool": "nuke",
  "deviceId": "<uuid>",
  "expiresAt": 1234567890,
  "offlineUntil": 1234567890,
  "revokedAt": null,
  "createdAt": 1234567890
}
```

`status` values: `active` | `revoked` | `expired` | `vault_locked`

Omit `grantId` to get all non-revoked grants for the caller on this package.

**Bridge behaviour on non-`active` status:**

- `revoked` or `vault_locked` → immediately close the package, purge local cache
- `expired` → close the package
- Network unreachable + `now < offlineUntil` → allow continued offline use

---

## 5. Grant Revocation (web-initiated)

Talent, rep, or admin can revoke a grant from the web app. This is surfaced in
**Admin → Bridge** (`/admin/bridge`).

```
DELETE /api/bridge/grants/:grantId
Authorization: (session cookie)
```

- Authorised callers: platform admin, the talent who owns the package, or a rep
  with delegation access to that talent
- Sets `revokedAt` on the grant in D1
- Writes a `cache_purged` bridge event to the audit log
- Returns `{ "ok": true }`

The bridge detects revocation on next poll (step 4 above).

---

## 6. Integrity Events

The bridge reports security events back to the platform.

```
POST /api/bridge/events
Authorization: Bearer brt_...
Content-Type: application/json

{
  "packageId": "<uuid>",
  "deviceId": "<uuid>",
  "eventType": "tamper_detected",
  "severity": "critical",
  "grantId": "<uuid>",
  "detail": { "file": "body_scan.exr", "expectedHash": "abc...", "actualHash": "def..." }
}
```

Allowed `eventType` values:

| eventType | Meaning |
|---|---|
| `tamper_detected` | File contents have been modified |
| `unexpected_copy` | File was copied outside the bridge's managed cache |
| `hash_mismatch` | SHA-256 check on cached file failed |
| `lease_expired` | Grant or offline grace period has passed |
| `cache_purged` | Local cache has been deleted (also written server-side on revocation) |
| `open_denied` | A DCC tool attempted to open a file and was refused |

`severity`: `info` | `warn` | `critical` (default: `warn`)

Returns `{ "ok": true }` (201).

---

## 7. Required Cloudflare Secrets

These must be set via Wrangler before the bridge endpoints work in production:

| Secret | Source | Required for |
|---|---|---|
| `BRIDGE_SIGNING_KEY_JWK` | Generate with `openssl ecparam -name prime256v1 -genkey` then export as JWK | Signing grant manifests |
| `R2_ACCESS_KEY_ID` | Cloudflare Dashboard → R2 → API Tokens | Presigning R2 source URLs |
| `R2_SECRET_ACCESS_KEY` | Same | Same |
| `CF_ACCOUNT_ID` | Cloudflare Dashboard | Constructing R2 endpoint URL |
| `R2_BUCKET_NAME` | Optional — defaults to `image-vault-scans` | Presigning |

---

## 8. D1 Schema (bridge tables)

All bridge tables are defined in `migrations/0005_cas_bridge.sql` (to be
created — see section 10 below). The Drizzle schema is in `lib/db/schema.ts`.

### `bridge_tokens`

| column | type | notes |
|---|---|---|
| id | TEXT PK | UUID |
| userId | TEXT | FK → users.id |
| tokenHash | TEXT UNIQUE | sha256 of raw PAT |
| displayName | TEXT | user-facing label |
| lastUsedAt | INTEGER | Unix seconds, updated on auth |
| createdAt | INTEGER | |
| revokedAt | INTEGER NULL | set on DELETE |

### `bridge_devices`

| column | type | notes |
|---|---|---|
| id | TEXT PK | UUID assigned by server |
| userId | TEXT | FK → users.id |
| fingerprint | TEXT UNIQUE | hardware-derived string |
| displayName | TEXT | |
| createdAt | INTEGER | |
| lastSeenAt | INTEGER | updated on grant open |

### `bridge_grants`

| column | type | notes |
|---|---|---|
| id | TEXT PK | UUID (= grantId in manifest) |
| licenceId | TEXT | FK → licences.id |
| packageId | TEXT | FK → scan_packages.id |
| userId | TEXT | licensee's userId |
| tool | TEXT | which DCC tool requested this |
| deviceId | TEXT | |
| allowedTools | TEXT | JSON array |
| manifestJson | TEXT | full manifest as stored |
| signature | TEXT | base64url ECDSA sig |
| keyId | TEXT | signing key identifier |
| expiresAt | INTEGER | |
| offlineUntil | INTEGER | |
| createdAt | INTEGER | |
| revokedAt | INTEGER NULL | |

### `bridge_events`

| column | type | notes |
|---|---|---|
| id | TEXT PK | UUID |
| grantId | TEXT NULL | FK → bridge_grants.id |
| packageId | TEXT | |
| deviceId | TEXT | |
| userId | TEXT | |
| eventType | TEXT | see section 6 |
| severity | TEXT | info / warn / critical |
| detail | TEXT NULL | JSON blob |
| createdAt | INTEGER | |

---

## 9. UI Pages (already built)

### `/settings/bridge`

- Lists the user's PATs (display name, created, last used, revoked status)
- Create new PAT (shows raw token once in a modal — copy prompt)
- Revoke individual PATs
- Links to device list

### `/admin/bridge`

- Platform admin view of all bridge grants across all users
- Shows grant status, tool, device, licence, package
- "Revoke" button calls `DELETE /api/bridge/grants/:grantId`
- Shows recent bridge events (tamper alerts, etc.)

---

## 10. Outstanding Work (for agents picking this up)

### 10.1 D1 migration file

The bridge tables need a migration file. Create
`migrations/0005_cas_bridge.sql` with `CREATE TABLE IF NOT EXISTS` statements
matching the schema in section 8. Then run:

```bash
wrangler d1 migrations apply image-vault-db
```

### 10.2 Signing key setup

Generate a P-256 ECDSA key pair and store the **private key JWK** as
`BRIDGE_SIGNING_KEY_JWK`:

```bash
# generate
openssl ecparam -name prime256v1 -genkey -noout -out bridge_private.pem
openssl ec -in bridge_private.pem -pubout -out bridge_public.pem

# convert to JWK (use a small Node script or https://mkjwk.org)
# then:
wrangler secret put BRIDGE_SIGNING_KEY_JWK
```

Store the **public key** in the bridge app's macOS Keychain so it can verify
manifests offline.

### 10.3 Bridge app public-key verification

The bridge Swift app must verify the ECDSA signature on every manifest it
receives using the stored public key. This prevents a compromised network path
from injecting a forged manifest.

### 10.4 Licence settings UI for DCC access

The licence creation / approval flow should let the talent or rep see which
DCC tools will be permitted (derived from `licenceType`). This is informational
only — the server enforces the matrix. Suggested location: the licence detail
page at `/licences/[id]`.

### 10.5 Bridge event admin notifications

When `severity = 'critical'` events arrive, platform admins should receive an
email notification (via the Resend integration planned for Phase 5). Add a
post-insert trigger or a background check.

### 10.6 Device trust enforcement (optional v2)

Currently, unknown devices are allowed through with a warning. A future
enhancement would let talent approve/deny devices before any grant is issued.
This requires a `trusted` flag on `bridge_devices` and a UI notification flow.

---

## 11. Bridge App ↔ API Sequence Diagram

```
Bridge startup
  └─► POST /api/bridge/devices           register or update device fingerprint

User opens package in Nuke
  └─► POST /api/bridge/packages/:id/open  validate licence + issue manifest
        ├── server checks: licence APPROVED, not expired, tool allowed, vault unlocked
        ├── generates presigned R2 URLs (24h TTL)
        ├── signs manifest with ECDSA P-256
        └── returns manifest + signature → bridge caches files locally

Every ~5 minutes (online)
  └─► GET /api/bridge/packages/:id/status?grantId=...
        └── if status != "active" → close package, purge cache

On integrity anomaly
  └─► POST /api/bridge/events             report event to platform

On user-initiated revocation (web UI)
  └─► DELETE /api/bridge/grants/:grantId
        └── next poll returns status: "revoked" → bridge purges cache
```

---

## 12. Related Files in This Repo

| File | Purpose |
|---|---|
| `app/api/bridge/tokens/route.ts` | PAT create / list |
| `app/api/bridge/tokens/[id]/route.ts` | PAT revoke |
| `app/api/bridge/devices/route.ts` | Device register / list |
| `app/api/bridge/packages/[packageId]/open/route.ts` | Grant manifest issuance |
| `app/api/bridge/packages/[packageId]/status/route.ts` | Status polling |
| `app/api/bridge/grants/[grantId]/route.ts` | Grant revocation |
| `app/api/bridge/events/route.ts` | Integrity event ingestion |
| `app/(vault)/settings/bridge/` | Licensee PAT management UI |
| `app/(vault)/admin/bridge/` | Admin grants + events view |
| `lib/auth/requireBridgeToken.ts` | PAT validation middleware |
| `lib/db/schema.ts` | Drizzle ORM schema (bridge_* tables) |

---

_Last updated: 2026-03-24. Branch: `api-bridge`._

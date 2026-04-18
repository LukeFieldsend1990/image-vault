# Image Vault — Product Specification

> **Secure biometric likeness archive for talent in the film, TV and commercial industry.**
> High-net-worth actors store high-fidelity scan packages for periodic archival and licensed distribution.

---

## Table of Contents
1. [Overview](#1-overview)
2. [User Roles](#2-user-roles)
3. [Product Requirements](#3-product-requirements)
4. [Architecture](#4-architecture)
5. [Security Model](#5-security-model)
6. [Licensing Model](#6-licensing-model)
7. [Multi-Tenancy & Branding](#7-multi-tenancy--branding)
8. [Cross-Functional Requirements](#8-cross-functional-requirements)
9. [Product Backlog / TODO](#9-product-backlog--todo)
10. [April 8 Pitch — Agency Feature Sprint](#10-april-8-pitch--agency-feature-sprint)
11. [In-App Notification Centre](#11-in-app-notification-centre)
12. [Access Windows — Controlled Temporary Download Access](#12-access-windows--controlled-temporary-download-access)
13. [Semantic Search — Licensee Package Discovery](#13-semantic-search--licensee-package-discovery)
14. [Trial Production — End-to-End Proving Ground](#14-trial-production--end-to-end-proving-ground)

---

## 1. Overview

Image Vault is a B2B SaaS platform allowing talent (actors) and their representatives to:
- Securely archive periodic high-fidelity likeness scans (200 GB – 1 TB per scan)
- Manage access controls and licences for production companies
- Distribute licensed access to scans via a dual-custody, time-limited download flow

All data is client-side encrypted before leaving the browser. The platform holds **zero plaintext access** to scan files.

**Stack:** Next.js 16 (App Router) · Cloudflare Pages · Cloudflare R2 · Cloudflare D1 · Cloudflare KV · Wrangler

---

## 2. User Roles

| Role | Description | Key Permissions |
|---|---|---|
| **Talent** | The actor whose likeness is stored | Upload scans, manage vault, approve/deny licence requests, revoke access |
| **Rep / Agency** | Manages vault on talent's behalf | Same as Talent (delegated), cannot modify licence approval threshold |
| **Licensee** | Production company requesting access | Browse available talent, request licence, download approved scan packages |
| **Platform Admin** | Operates the platform | User management, audit log access, billing, platform health |

---

## 3. Product Requirements

### 3.1 Authentication & Identity
- [x] Email + password sign-up with role selection — *email verification deferred*
- [x] TOTP-based 2FA (authenticator app) — mandatory for all roles
- [ ] SMS fallback 2FA (Twilio)
- [x] Session management with short-lived JWTs (15 min) + refresh tokens (7 day) in HttpOnly cookies — *silent refresh via /api/auth/refresh*
- [ ] Device trust / known device registry
- [ ] Account recovery flow with identity verification gate

### 3.2 Talent Vault
- [x] Vault dashboard showing all scan packages with metadata (name, description, capture date, studio, notes, file list)
- [ ] Scan versioning — multiple scans per talent, chronological history
- [x] Scan metadata: capture date, studio/facility, technician notes, file manifest
- [ ] Vault activity log (who accessed what, when) — *deferred to Phase 5 audit log*
- [x] Rep delegation — talent can grant/revoke rep access; rep can act on talent's behalf
- [x] Vault lock — talent can freeze all outbound access globally with one action (`vault_locked` DB field, `/api/settings/vault-lock`, enforced at licence creation + download initiation)

### 3.3 Large File Upload (200 GB – 1 TB)
- [ ] Chunked multipart upload directly to R2 via presigned URLs (never routed through Worker) — *current impl buffers 50 MB chunks through Worker (supports ~500 GB); presigned URL path needed for full 1 TB support*
- [x] Resumable uploads — status API (`GET /api/vault/upload/status`), resume modal (skips completed parts by filename+size match), "Resume" button on in-progress packages in dashboard
- [x] Upload progress UI with per-chunk status and overall ETA
- [ ] Client-side AES-256-GCM encryption of each chunk before upload — *deferred (zero-knowledge layer)*
- [ ] Integrity verification — SHA-256 hash per chunk and full file, verified post-upload
- [x] Upload session management — upload_sessions table tracks multipart state; incomplete uploads can be resumed
- [x] Multi-file upload — a scan package may contain multiple files (body, face, hands, etc.)

### 3.4 Large File Download (for licensees)
- [ ] Chunked download with reassembly and decryption in-browser
- [ ] Parallel chunk download for maximum throughput
- [ ] Download progress UI with speed meter
- [ ] Resume interrupted downloads
- [ ] Downloaded file integrity check before delivery to filesystem

### 3.5 Licensing & Access Control
- [x] Licensee submits a licence request specifying: project name, production company, intended use, date range, file scope
- [x] Talent/rep reviews request and approves or denies with optional reason — *email notification deferred to Phase 5*
- [x] **Dual-custody download**: both Talent/Rep AND Licensee must complete their own TOTP 2FA challenge; KV state machine orchestrates the handshake
- [x] Download tokens expire after 48 hours (KV TTL)
- [x] Download attempt is logged in download_events table with timestamp, IP, user agent
- [x] Licence revocation — Talent can revoke an active licence; in-flight KV sessions are invalidated
- [ ] Licence audit trail — download_events table captures per-download activity; full structured audit log deferred to Phase 5

### 3.6 Notifications
- [x] Email notifications via Resend — all transactional emails implemented: new licence request, licence approved, licence denied, licence revoked, upload complete, dual-custody download authorisation request, dual-custody download complete, user invite (`lib/email/templates.ts` + `lib/email/send.ts`)
- [ ] In-app notification centre — spec in §11
- [ ] Configurable notification preferences per user

### 3.8 Scan Bookings
- [ ] Talent can book a scan session at a Changling mobile popup location (Claridge's London, Chateau Marmont LA, The Plaza NYC)
- [ ] Calendar UI showing upcoming popup events with available time slots
- [ ] Booking confirmation and cancellation (>48h before slot) with email notifications
- [ ] 24h reminder email to talent before their session
- [ ] Admin can create and manage popup events and slots (`/admin/bookings`)
- [ ] Post-scan: admin uploads completed package directly to talent's vault; talent is notified

### 3.9 Production Entities & Package Metadata
- [ ] Productions as first-class entities with deduplicated names (not free-text strings on licences)
- [ ] Production companies as first-class entities
- [ ] Autocomplete suggest-on-type in licence request form — matches existing, creates new if no match
- [ ] Admin pages to browse/search/edit productions and companies (`/admin/productions`)
- [ ] Merge duplicate productions (reassign licences)
- [ ] Extended scan package metadata — scan type, resolution, polygon count, capabilities flags, tags
- [ ] Package metadata editing page (`/vault/packages/[id]/metadata`) — talent/rep/admin can enrich post-upload
- [ ] Backfill migration: existing free-text `project_name`/`production_company` → entity FKs

### 3.7 Admin Panel
- [x] User management — invite (via `/admin/invites`), suspend/unsuspend (`PATCH /api/admin/users/[id]`, revokes refresh tokens immediately), delete (`DELETE /api/admin/users/[id]`); suspended users blocked at login + refresh
- [x] Platform-wide audit log — `/admin/audit` shows last 500 download events with licensee, file, project, IP, timestamp
- [x] Storage usage dashboard — `/admin/storage` shows per-talent storage aggregated from completed scan files with proportional bar chart
- [ ] Billing summary (Cloudflare R2 costs, per-talent)
- [ ] Feature flags

---

## 4. Architecture

### 4.1 Infrastructure (Cloudflare Stack)

```
Browser
  │
  ├─ Next.js App (Cloudflare Pages)
  │    └─ API Route Handlers (Edge Runtime)
  │         ├─ Auth / Session → KV (SESSIONS_KV)
  │         ├─ Metadata CRUD → D1 (DB)
  │         ├─ Presigned URL generation → R2 (SCANS_BUCKET)
  │         └─ Dual-custody token orchestration → KV
  │
  ├─ Direct Upload to R2 (presigned multipart — bypasses Worker)
  └─ Direct Download from R2 (presigned GET — bypasses Worker)
```

### 4.2 Services

| Service | Purpose | Tier |
|---|---|---|
| **Cloudflare Pages** | Next.js hosting + edge API routes | Free |
| **Cloudflare R2** | Scan file storage | Free 10GB, then $0.015/GB (no egress fees) |
| **Cloudflare D1** | Relational metadata, users, licences, audit log | Free (5GB) |
| **Cloudflare KV** | Sessions, download tokens, upload state | Free (1GB) |
| **Cloudflare Access** | Zero Trust identity layer (optional layer 2) | Free up to 50 users |
| **Resend** | Transactional email | Free 3k/month |
| **Twilio** | SMS 2FA | Pay-per-use |

### 4.3 Key Design Decisions

**Why direct-to-R2 upload?**
Cloudflare Workers have a 128 MB request body limit. Files up to 1 TB must be uploaded as multipart directly to R2 using presigned URLs generated by the Worker — the Worker never handles the file bytes.

> **Current implementation note:** V1 routes 50 MB chunks through the Worker via `multipartUpload.uploadPart()`. This works for files up to ~500 GB (50 MB × 10,000 parts = 500 GB). For full 1 TB support, true presigned multipart URLs (bypassing the Worker) are required — tracked in §3.3.

**Why client-side encryption?**
The platform operates with zero-knowledge of file contents. Each scan is encrypted with a per-file AES-256-GCM key in the browser before any bytes are sent to R2. The platform never holds the plaintext.

**Key management (high level):**
- Each scan has a unique Content Encryption Key (CEK)
- CEKs are encrypted with the talent's Key Encryption Key (KEK)
- KEKs are derived from the talent's passphrase using PBKDF2 (never sent to server)
- For licensed access, a CEK is re-encrypted with the licensee's public key and stored in D1
- This is an **end-to-end encrypted key exchange** — the platform sees only encrypted key material

### 4.4 CI/CD — Cloudflare Pages Native

Deployment is handled entirely through **Cloudflare Pages Git integration** — no GitHub Actions required.

```
GitHub repo (main branch)
  │
  ├─ Push to main → Cloudflare Pages Production deployment (auto)
  └─ Push to any other branch → Cloudflare Pages Preview deployment (auto)
       └─ PR preview URL generated per branch
```

- **Production:** `https://changling.io`
- **Preview:** `https://<branch>.<project>.pages.dev` per PR/branch
- Wrangler secrets managed via Cloudflare dashboard (never in repo)
- D1 migrations run via `wrangler d1 migrations apply` as part of release process
- No GitHub Actions needed — Cloudflare Pages builds on every push

---

## 5. Security Model

### 5.1 Threat Model
- **Platform compromise:** Cloudflare R2/D1 breach exposes only ciphertext. No plaintext file data at rest on server.
- **Rogue admin:** Admins cannot access scan files (no key material server-side).
- **Credential theft:** TOTP 2FA + short-lived sessions limit blast radius.
- **Insider threat (licensee):** Dual-custody download ensures Talent/Rep participates in every download. Download URLs expire. All downloads are logged.
- **Link sharing:** Presigned URLs are bound to the requesting licensee's IP (where feasible) and expire.
- **Scan exfiltration:** Watermarking metadata can be embedded into download packages for forensic traceability.

### 5.2 Compliance Considerations (TBD — see §8)
- GDPR — biometric data is special category personal data
- CCPA — California residents
- UK GDPR
- Biometric data legislation (Illinois BIPA, Texas CUBI, etc.)

---

## 6. Licensing Model

### 6.0 Strategic Context

Likeness scans are not a one-time product — they are **a recurring digital identity asset**. The platform's licensing layer is the mechanism by which talent and their representatives monetise that asset repeatedly across different use cases, territories, and terms.

The industry has fundamentally shifted post-SAG-AFTRA 2023. Productions now need contractual, audited, consent-based access to digital likenesses — not informal agreements or one-off scans. A platform that:

1. **Stores** the canonical scan (the authoritative source of truth)
2. **Contracts** usage per production in a machine-readable, auditable way
3. **Enforces** dual-custody custody custody (talent must actively participate in every download)
4. **Tracks** all downstream usage events with a tamper-evident log

...is positioned as critical IP infrastructure for the industry, not just file storage.

---

### 6.1 Licence Types

Every licence request must specify a usage type. These are not free-form text — they are a controlled enumeration that drives contract templates, fee guidance, and technical constraints.

| Type | Value | Description | Typical Fee Range |
|---|---|---|---|
| **Film / TV Digital Double** | `film_double` | Photorealistic recreation in a theatrical or streaming production | £50k – £300k |
| **Video Game / Real-Time Character** | `game_character` | Integration into a game engine (Unreal / Unity) for playable or NPC use | £100k – £500k |
| **Commercial / Advertising** | `commercial` | Brand campaigns, product ads — digital or print | £25k – £100k |
| **AI Avatar / Synthetic Performance** | `ai_avatar` | Controlled AI-driven performance (Synthesia, HeyGen, custom); voice clone may be included | £2k – £50k per campaign |
| **Training Dataset** | `training_data` | Input for ML model training (generative, reconstruction, avatar systems) — requires explicit AI consent flag | £100k – £1M+ |
| **Likeness Monitoring / Reference** | `monitoring_reference` | Internal reference for deepfake detection / watermark verification; no creative use | £5k – £20k/yr |

> **AI training is off by default.** The `permitAITraining` flag on a licence is `false` unless explicitly enabled by the talent during approval — regardless of usage type. A licensee cannot request AI training rights; the talent must grant them.

---

### 6.2 Licence Fields — Extended

In addition to the current schema, the commercial layer adds:

| Field | Type | Description |
|---|---|---|
| `licenceType` | enum | One of the six usage types above |
| `territory` | TEXT | `worldwide` \| `europe` \| `uk` \| `usa` \| `asia_pacific` \| custom |
| `exclusivity` | boolean | Whether this is an exclusive licence for the territory + type |
| `permitAITraining` | boolean | Talent opt-in only; default false; shown prominently in talent review UI |
| `agreedFee` | INTEGER | Agreed fee in pence (GBP); set by talent/rep during approval |
| `platformFeePercent` | INTEGER | Platform commission rate at time of licence; default 15 |
| `platformFee` | INTEGER | Calculated: agreedFee × platformFeePercent / 100 |
| `talentFee` | INTEGER | agreedFee − platformFee |
| `downloadLimit` | INTEGER | Max number of download events (null = unlimited within validity period) |
| `contractStatus` | enum | `draft` \| `pending_signature` \| `executed` \| `void` |
| `contractUrl` | TEXT | Signed contract PDF URL (DocuSign / HelloSign or platform-generated) |
| `talentNotes` | TEXT | Internal notes from talent/rep on approval conditions |

---

### 6.3 Dual-Custody Download Flow (current — Phase 4)

```
1. Licensee submits licence request (project, use case, date range)
        ↓
2. Talent/Rep receives notification → reviews → approves or denies
        ↓ (approved)
3. Licence record created in D1 with status: APPROVED_PENDING_DOWNLOAD
        ↓
4. Licensee initiates download session
        ↓
5. System issues 2FA challenge to LICENSEE — must complete within 5 min
        ↓
6. On licensee 2FA success → system issues 2FA challenge to TALENT/REP
        ↓
7. On talent 2FA success → presigned R2 URL generated (48h TTL, scoped)
        ↓
8. Licensee receives download link — download begins
        ↓
9. Download event logged: timestamp, IP, user agent, bytes transferred
```

### 6.4 Enhanced Licence Request Wizard (Phase 4 Extended — Demo Priority)

The licence request form is the **commercial heart of the platform**. The current form is functional but generic. For the demo and commercial pitch, this becomes a structured wizard.

**Step 1 — Usage type**
- Visual tile picker: Film Double / Game Character / Commercial / AI Avatar / Training Dataset / Monitoring
- Each tile shows: description, typical fee range, what the licensee gets
- Selection drives all subsequent steps

**Step 2 — Project details**
- Project name, production company, brief description
- Territory selector (worldwide / region / country)
- Exclusivity toggle with explanation of implications
- Duration: specific dates OR production-lifecycle option

**Step 3 — AI terms**
- Displayed regardless of usage type
- Explicit declaration: "This licence does NOT grant rights to use likeness data for AI model training unless separately approved by the talent"
- Checkbox: "I confirm I will not use this data for AI training"
- If `training_data` type is selected: "AI training rights must be separately negotiated with the talent's representative"

**Step 4 — Commercial terms**
- Talent-set indicative fee displayed (if configured): "Indicative fee for this usage type: £X – £Y"
- Proposed fee field: licensee can enter their proposed fee
- Note: "Final fee will be agreed with the talent's representative before licence execution"

**Step 5 — Declaration**
- Summary of request
- Terms acknowledgement
- Submit

---

### 6.5 Talent Approval Flow — Extended (Demo Priority)

When a talent or rep reviews an incoming request, they see:

- **Request summary**: project, usage type, territory, exclusivity, proposed fee, AI training flag
- **Earnings projection**: "At this fee, you would earn £X (after 15% platform commission)"
- **Suggested fee** for this usage type (platform guidance)
- **AI flag warning**: if `permitAITraining` was requested, a prominent red warning
- **Counter-offer**: ability to set a different agreed fee before approving
- **Conditional approval**: notes field ("approved subject to credit in end titles")
- **Contract preview**: on approval, the platform auto-generates a draft contract for review before the licence goes live

---

### 6.6 Auto-Generated Licence Contract

On licence approval, the platform generates a structured HTML/PDF contract from the licence record.

**Contract sections:**
1. **Parties** — talent name + agency, licensee production company
2. **Licensed material** — package name, scan date, file manifest
3. **Usage grant** — usage type, territory, exclusivity, duration
4. **Restrictions** — explicit prohibition on AI training (unless `permitAITraining = true`), watermarking obligations, no sub-licensing
5. **Fees & payment** — agreed fee, platform commission, payment terms
6. **Audit rights** — talent's right to request download event log at any time
7. **Revocation** — platform right to terminate access immediately; talent's right to revoke
8. **Governing law** — English law / GDPR compliance

The contract is stamped with:
- Licence ID (UUID)
- Approved timestamp
- Chain of custody link

**Signing:** Phase 1 = talent marks as "reviewed and accepted" in-platform. Phase 2 = DocuSign / HelloSign integration for binding e-signature.

---

### 6.7 Monetisation Model

**Platform revenue streams:**

| Stream | Model | Rate |
|---|---|---|
| **Agency subscription** | Annual fee per agency tenant | £50k – £150k/yr |
| **Licence commission** | % of agreed fee per executed licence | 15% (configurable per tenant) |
| **Storage** | Per-TB per month above free tier | Cost-plus (Cloudflare R2 at $0.015/GB) |
| **AI Monitoring** | Annual subscription per talent for likeness monitoring service | £2k – £5k/yr per talent |
| **Premium chain of custody** | Legal-grade timestamped audit export | Included in agency tier |

**For the demo (United Agents):**
- Show a credible "platform economics" slide: 50 talent × 3 licences/year × £100k avg fee × 15% = **£2.25M ARR from commission alone** at one agency
- Agency subscription is the floor; commission is the upside

---

### 6.8 Licence Record Fields (current)

```
1. Licensee submits licence request (project, use case, date range)
        ↓
2. Talent/Rep receives notification → reviews → approves or denies
        ↓ (approved)
3. Licence record created in D1 with status: APPROVED_PENDING_DOWNLOAD
        ↓
4. Licensee initiates download session
        ↓
5. System issues 2FA challenge to LICENSEE — must complete within 5 min
        ↓
6. On licensee 2FA success → system issues 2FA challenge to TALENT/REP
        ↓
7. On talent 2FA success → presigned R2 URL generated (48h TTL, scoped)
        ↓
8. Licensee receives download link — download begins
        ↓
9. Download event logged: timestamp, IP, user agent, bytes transferred
```

### 6.9 Licence Record Fields (current + extended)
- `id`, `talent_id`, `package_id`, `licensee_id`
- `project_name`, `production_company`, `intended_use`, `valid_from`, `valid_to`
- `licence_type` *(new)* — film_double | game_character | commercial | ai_avatar | training_data | monitoring_reference
- `territory` *(new)* — worldwide | europe | uk | usa | asia_pacific | custom
- `exclusivity` *(new)* — boolean
- `permit_ai_training` *(new)* — boolean, default false
- `agreed_fee` *(new)* — integer pence
- `platform_fee_percent` *(new)* — integer, default 15
- `download_limit` *(new)* — integer or null
- `contract_status` *(new)* — draft | pending_signature | executed | void
- `contract_url` *(new)* — TEXT
- `status`: PENDING | APPROVED | DENIED | REVOKED | EXPIRED
- `approved_by`, `approved_at`
- `dual_custody_completed_at`
- `download_count`, `last_download_at`

---

## 7. Multi-Tenancy & Branding

### 7.1 Strategy — Hardcoded Multi-Tenancy

The platform uses a **single backend** (one D1, one R2, one Cloudflare Pages deployment) with **per-agency hardcoded UI themes**. There are 5–6 target agencies; generic theming is not required. Each agency gets its own branded experience on the same codebase.

Tenant is identified by:
1. **Subdomain** (e.g., `unitedagents.changling.io`, `caa.changling.io`) — preferred
2. Or **custom domain** per agency

Theme config is a static TypeScript object per tenant — no DB involvement.

### 7.2 Target Agencies (Tenants)

| # | Agency | Status | Notes |
|---|---|---|---|
| 1 | **United Agents** | 🎯 V1 demo target | Primary pitch target |
| 2 | CAA | Planned | |
| 3 | WME | Planned | |
| 4 | UTA | Planned | |
| 5 | Troika | Planned | |
| 6 | Curtis Brown | Planned | |

### 7.3 United Agents Theme (V1)

Reference: https://www.unitedagents.co.uk/

| Token | Value | Usage |
|---|---|---|
| `--color-primary` | `#000000` | Navigation, headings, primary buttons |
| `--color-background` | `#FFFFFF` | Page background |
| `--color-surface` | `#F5F5F5` | Cards, panels |
| `--color-text` | `#333333` | Body text |
| `--color-accent` | `#000000` | Links, active states (monochrome — no accent colour) |
| `--font-sans` | System sans-serif (clean, contemporary) | Body copy, UI labels |
| `--font-display` | Same family, heavier weight | Headings |

**Visual style:**
- High contrast black/white, minimal colour
- Generous whitespace, grid-based
- Professional minimalism — no decorative elements
- Typography-led — text hierarchy does the work
- Clean navigation, no visual noise

### 7.4 Theme Architecture

```
/themes/
  index.ts          ← maps subdomain/domain → theme config
  types.ts          ← ThemeConfig interface
  united-agents.ts  ← United Agents tokens + assets
  caa.ts            ← CAA (stub)
  wme.ts            ← WME (stub)
  uta.ts            ← UTA (stub)
  troika.ts         ← Troika (stub)
  curtis-brown.ts   ← Curtis Brown (stub)
```

Theme is resolved at the edge (middleware) and injected as CSS variables + passed as a prop to the layout. No client-side flicker.

### 7.5 Tenant-Specific Pages
- Login page branded per agency (logo, colours, tagline)
- Download page branded per agency (most visible to licensees — production companies)
- Dashboard branded per agency
- Email notifications use agency branding (Resend templates per tenant)

---

## 8. Cross-Functional Requirements

### 8.1 Legal & Compliance
- [ ] Engage data protection counsel re: biometric data (GDPR Article 9, BIPA)
- [ ] Draft Terms of Service and Privacy Policy (biometric data clauses)
- [ ] Data Processing Agreement (DPA) template for licensees
- [ ] Establish data residency policy — confirm Cloudflare R2 bucket region (EU vs US) — currently WEUR
- [ ] Consent capture flow for talent at onboarding
- [ ] Right to erasure workflow (GDPR Article 17) — purge all scan data + keys

### 8.2 Security & Pen Testing
- [ ] Threat model review before launch
- [ ] Third-party penetration test of auth and download flows
- [ ] OWASP Top 10 audit of API routes
- [ ] Key management design review
- [x] Rate limiting on login (10/15 min) and 2FA verify (5/5 min) — KV sliding window
- [ ] Fix signup user enumeration: currently returns 409 for existing email vs 400 for bad input — should return identical responses
- [ ] Admin email whitelist is hardcoded in `lib/auth/adminEmails.ts` (by design — not an env var). Standalone workers (`ai-worker`, `ai-cron-worker`) maintain their own copy — keep in sync manually on change
- [ ] Download event notifications include client IP address — review GDPR implications and add opt-out or anonymisation

### 8.3 Infrastructure & DevOps
- [x] Cloudflare Pages Git integration — production deploys on merge to main, preview deploys per branch
- [ ] Connect GitHub repo to Cloudflare Pages project in dashboard
- [ ] **Required secrets** — set via Cloudflare Pages dashboard or `wrangler secret put` before go-live:
  - `JWT_SECRET` — session signing
  - `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` + `CF_ACCOUNT_ID` — presigned R2 URLs (upload & Bridge)
  - `RESEND_API_KEY` + `RESEND_FROM_EMAIL` — transactional email (licence requests, approvals, download alerts)
  - `TMDB_API_KEY` — talent onboarding search
  - `BRIDGE_SIGNING_KEY_JWK` — manifest signing for CAS Bridge desktop app
  - `NEXT_PUBLIC_BASE_URL` — used in all email links; falls back to `https://changling.io`
  - `ANTHROPIC_API_KEY` — AI suggestion engine (optional, graceful degrade)
  - `MESHY_API_KEY` — pipeline GLB generation (optional, graceful degrade)
- [ ] Add startup secret validation: log missing required secrets on cold start so misconfigs surface immediately instead of crashing on first request
- [ ] R2 CORS configuration for browser-direct presigned uploads — apply via `scripts/r2-cors-apply.sh` (requires `CF_ACCOUNT_ID` + `CF_API_TOKEN`)
- [ ] R2 bucket soft delete / lifecycle policy
- [x] D1 database migration strategy (Drizzle ORM — numbered SQL migrations applied via `wrangler d1 migrations apply`)
- [x] Cloudflare Workers observability — `[observability] enabled = true` in wrangler.toml; 200K events/day, 3-day retention; `wrangler tail` for real-time streaming
- [ ] Cloudflare Logpush → long-term audit log retention (R2 or external SIEM) — requires paid plan
- [ ] Bot Fight Mode enabled in Cloudflare dashboard (Security → Bots)
- [x] Rate limiting on auth routes — implemented in-app via KV sliding window (`lib/auth/rateLimit.ts`); Cloudflare dashboard rules optional additional layer
- [ ] Cloudflare Turnstile on login + signup forms (free, GDPR-safe CAPTCHA)
- [ ] Uptime monitoring and alerting

### 8.4 Scalability
- [ ] R2 multipart upload limits: max 10,000 parts × 5 GB = 50 TB max object — sufficient
- [ ] D1 row limits per table — monitor for audit log table growth, archive strategy
- [ ] KV TTL management for expired download tokens and sessions

### 8.5 Business & Operations
- [ ] Talent onboarding flow / white-glove setup for HNW clients
- [ ] Pricing model (per-seat? per-GB? per-licence?)
- [ ] Stripe integration for billing
- [ ] Customer support workflow
- [ ] SLA commitments

---

## 9. Product Backlog / TODO

### 🔴 Phase 0 — Foundation
- [x] Initialise Next.js + Cloudflare Pages project
- [x] Configure `wrangler.toml` with R2, D1, KV bindings
- [x] Create R2 buckets (`image-vault-scans`, `image-vault-scans-dev`)
- [x] Create D1 database (`image-vault-db`, ID: `71665618-0498-48bd-a243-962eb4810769`)
- [x] Create KV namespace (`SESSIONS_KV`, ID: `3d37f156b49348cdad79e28e8812b7e3`)
- [ ] Connect GitHub repo to Cloudflare Pages in dashboard (one-time manual step)
- [x] Initial D1 schema migration (0001_vault.sql, 0002_licensing.sql, 0003_rep_delegation.sql — all applied `--remote`)
- [x] 0004_talent_profiles.sql — talent_profiles table (TMDB onboarding)
- [x] 0005_upload_sessions.sql — upload_sessions table (resumable uploads)
- [x] 0006_invites.sql — invites table (invite-gated signup)
- [x] 0007_users_status.sql — vault_locked + suspended_at columns on users

### ✅ Phase 1 — Auth
- [x] Database schema: users, sessions, devices, 2fa_methods
- [x] Sign up flow (email + password + role selection) — talent/rep require invite token; licensee can self-register; invite pre-fills and locks email + role
- [ ] Email verification on sign-up (not yet implemented)
- [x] Login with TOTP 2FA; suspended accounts blocked at login + refresh
- [x] JWT + refresh token session management (HttpOnly cookies)
- [x] Role-based access control middleware
- [x] Invite-gated signup — admin can invite any role; talent can invite reps (auto-links talentReps) and licensees; `/admin/invites` management UI; invite email sent via Resend

### 🟡 Phase 1.5 — Theme Engine
- [ ] `ThemeConfig` interface and theme resolver middleware — *multi-tenant engine deferred; theme currently hardcoded*
- [x] United Agents theme tokens (black/white, red accent `#c0392b`) — hardcoded in `app/globals.css`
- [x] CSS variable injection (no FOUC) — all tokens available globally via `:root` CSS variables
- [ ] Branded login page (logo, tagline per agency)
- [ ] Stub theme files for remaining 5 agencies (CAA, WME, UTA, Troika, Curtis Brown)

### ✅ Phase 2 — Vault & Upload
- [x] Database schema: scan_packages, scan_files, upload_sessions
- [x] Talent vault dashboard with expandable package cards + file list
- [x] Multipart upload orchestration API — initiate, upload part (via Worker), complete; upload-complete triggers email to talent
- [ ] Client-side AES-256-GCM chunk encryption (deferred — zero-knowledge layer)
- [x] Upload progress UI with per-file progress bars
- [x] Resumable uploads — GET /api/vault/upload/status; resume modal skips completed parts; dashboard "Resume" button on in-progress packages

### ✅ Phase 3 — Download
- [x] R2 → browser streaming download per file
- [x] Expandable package cards with per-file download buttons
- [ ] Chunked download with in-browser AES-256-GCM decryption (deferred — tied to encryption)
- [ ] Download speed / progress meter
- [ ] Branded download page per agency (deferred to Phase 5)

### ✅ Phase 4 — Licensing & Dual Custody
- [x] Database schema: licences, download_events (0002_licensing.sql applied --remote)
- [x] Licence request flow (licensee) — /licences/request/[packageId], POST /api/licences
- [x] Licence review / approval / denial flow (talent / rep) — /vault/requests, approve + deny APIs
- [x] Dual-custody 2FA orchestration — initiate → licensee-2fa → talent-2fa via KV state machine
- [x] Download token generation (KV tokens → /api/download/[token] streams R2, 48h TTL)
- [x] Licence revocation + KV session invalidation
- [x] All role UI flows: directory, talent profile, licensee dashboard, talent requests + licences, authorise pages
- [x] Role-aware nav (talent vs licensee), layout reads role from JWT cookie
- [x] Rep delegation — talent_reps table (0003_rep_delegation.sql), hasRepAccess() helper
- [x] /api/delegation + /api/roster — invite/remove reps, list managed talent with package counts
- [x] /settings/delegation — talent invite/remove rep by email
- [x] /roster — rep's list of managed talent; /roster/[talentId] — act-as-talent vault view with red banner
- [x] User widget with role-aware dropdown (logout, settings, manage reps / my roster)

#### Phase 4 — UI Flows

**4A — Talent Directory (Licensee)**
- `/directory` — searchable/filterable grid of talent available for licensing
  - Cards: name, agency, scan count, last scan date (no file previews)
  - Filter by: agency, scan type, date range
- `/talent/[id]` — talent profile page (licensee view)
  - Metadata only: bio, scan package list (dates, sizes, types)
  - CTA: "Request Licence" per package

**4B — Licence Request Form (Licensee)**
- `/licences/request/[packageId]` — single-page form
  - Fields: project name, production company, intended use, date range, file scope (all files / subset)
  - Declaration checkbox (data handling terms)
  - Submit → creates `PENDING` licence record → notifies talent/rep
- `/licences` — licensee's licence dashboard
  - Tabs: Pending / Approved / Denied / Expired / Revoked
  - Per-licence: status badge, package name, date range, requested date
  - Approved licences show "Download" CTA

**4C — Licence Review (Talent / Rep)**
- `/vault/requests` — incoming licence requests list
  - Per-request: licensee name, project, intended use, date range, requested package
  - Actions: Review / Ignore
- `/vault/requests/[licenceId]` — request detail page
  - Full request context
  - Approve button → transitions to `APPROVED_PENDING_DOWNLOAD`
  - Deny button + optional reason field → transitions to `DENIED`, notifies licensee
- `/vault/licences` — active licences panel
  - List of approved licences with licensee, package, expiry, download count
  - Revoke button per licence → invalidates presigned URLs, transitions to `REVOKED`

**4D — Dual-Custody Download Flow (Licensee)**
- `/licences/[licenceId]/download` — download initiation page
  - Shows: package summary, licence terms, expiry
  - "Start Download" → triggers dual-custody orchestration
  - Step 1 shown: "Verify your identity — enter the code from your authenticator"
  - TOTP form → on success, system sends 2FA challenge to talent/rep
  - Waiting state: "Awaiting approval from [Agency Name] — this may take a few minutes"
  - On talent 2FA complete → presigned URL issued, download begins
  - Download progress bar (bytes / total, estimated time)

**4E — Dual-Custody 2FA Challenge (Talent / Rep)**
- Push notification / email → deep link to `/vault/authorise/[token]`
  - Shows: licensee name, project, package name, requested at timestamp
  - "Authorise Download" → TOTP challenge
  - On success → system issues presigned URL to licensee
  - "Deny" option → cancels the pending download session

**4F — Rep / Agency Delegation UI**
- `/settings/delegation` (talent view)
  - List of reps with access, granted date
  - Invite rep by email / revoke
- `/roster` (rep view)
  - Grid of talent they represent
  - Per-talent: vault status, pending requests count, last activity
  - "Act as [Talent Name]" → scoped session (banner shown throughout UI)

#### Phase 4 — API Routes
- `POST /api/licences/request` — create licence request
- `GET /api/licences` — list licences (scoped by role)
- `POST /api/licences/[id]/approve` — talent/rep approves
- `POST /api/licences/[id]/deny` — talent/rep denies
- `POST /api/licences/[id]/revoke` — talent/rep revokes
- `POST /api/licences/[id]/download/initiate` — licensee starts dual-custody flow
- `POST /api/licences/[id]/download/licensee-2fa` — licensee TOTP verification
- `POST /api/licences/[id]/download/talent-2fa` — talent/rep TOTP verification → issues URL
- `GET /api/licences/[id]/download/status` — poll for presigned URL readiness

#### Phase 4 — DB Schema Additions
```sql
CREATE TABLE licences (
  id TEXT PRIMARY KEY,
  talent_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  licensee_id TEXT NOT NULL,
  project_name TEXT NOT NULL,
  intended_use TEXT NOT NULL,
  valid_from INTEGER NOT NULL,
  valid_to INTEGER NOT NULL,
  file_scope TEXT NOT NULL DEFAULT 'all',
  status TEXT NOT NULL DEFAULT 'PENDING',
  approved_by TEXT,
  approved_at INTEGER,
  denied_at INTEGER,
  denied_reason TEXT,
  revoked_at INTEGER,
  dual_custody_token TEXT,
  dual_custody_expires_at INTEGER,
  dual_custody_completed_at INTEGER,
  download_count INTEGER NOT NULL DEFAULT 0,
  last_download_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE download_events (
  id TEXT PRIMARY KEY,
  licence_id TEXT NOT NULL,
  licensee_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  bytes_transferred INTEGER,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  presigned_url_expires_at INTEGER
);
```

### 🟠 Phase 5 — Notifications & Admin
- [x] Email notifications via Resend — all transactional templates built and wired (`lib/email/templates.ts`): upload complete, download authorisation request, download complete, licence requested/approved/denied/revoked, invite
- [ ] Email delivery reliability: currently fire-and-forget with silent failure if `RESEND_API_KEY` missing or API errors. Add: (a) log failed sends to D1 for admin visibility, (b) optional retry queue (KV-backed, 3 attempts with backoff)
- [x] Cloudflare observability enabled — `[observability] enabled = true` in `wrangler.toml`; view logs at Pages → Functions → Logs; tail locally with `wrangler tail`
- [ ] In-app notification centre — spec in §11, migration `0026_notifications.sql`
- [x] Admin panel — user management (invite/suspend/delete), audit log (`/admin/audit`), storage dashboard (`/admin/storage`)
- [ ] Admin billing summary (R2 costs per talent)
- [ ] Feature flags

### 🔵 Phase 5.5 — Scan Bookings

Talent can book a scan session at one of Changling's mobile popup locations. The scanning rig is transported to partner hotels; our technicians upload the resulting package directly to the talent's vault on their behalf.

#### Popup Locations (V1)

| # | City | Hotel | Why |
|---|---|---|---|
| 1 | **London** | **Claridge's**, Brook Street, Mayfair | The spiritual home of British celebrity — so embedded in film and TV it barely needs an introduction. Agatha Christie set scenes here; it appears in *Paddington*, *Skyfall*, countless period dramas. Every serious actor in London knows a room here. |
| 2 | **Los Angeles** | **Chateau Marmont**, Sunset Boulevard | The undisputed capital of Hollywood mythology. Jim Morrison, Led Zeppelin, the Belushi incident, Lindsay Lohan's residency. Featured or referenced in *Mulholland Drive*, *Almost Famous*, *The Player*. If you're a serious actor in LA, you've been here. |
| 3 | **New York** | **The Plaza**, Fifth Avenue & Central Park South | Home Alone 2 cemented it for a generation. Eloise lived here. The Beatles stayed here. *North by Northwest*, *Almost Famous*, *Bride Wars*, *Scent of a Woman*. The most iconic hotel address in New York. |

#### Feature Requirements

**3.8 Scan Bookings**
- [ ] Talent can view upcoming popup events across all locations from a dedicated `/bookings` page
- [ ] Fancy calendar UI — month view with event dots; click a date to expand available slots
- [ ] Each popup event has a configurable number of time slots (e.g. 9:00, 10:30, 12:00, 14:00, 15:30, 17:00)
- [ ] Talent selects a slot and submits a booking — slot is marked reserved
- [ ] Confirmation email sent to talent with date, time, location, hotel address, and what to expect
- [ ] Talent can cancel a booking (up to 48 hours before); slot is released back to available
- [ ] Admin can create, edit, and cancel popup events (`/admin/bookings`)
- [ ] Admin can view all bookings per event, mark slot as completed, add notes
- [ ] On completion, admin uploads the resulting scan package directly to the talent's vault
- [ ] Post-scan confirmation email to talent: "Your scan has been uploaded to your vault"

#### DB Schema

```sql
CREATE TABLE scan_locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,           -- e.g. "Claridge's"
  city TEXT NOT NULL,           -- e.g. "London"
  address TEXT NOT NULL,
  hotel_image_url TEXT,         -- for UI display
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE scan_events (
  id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL REFERENCES scan_locations(id),
  date INTEGER NOT NULL,        -- unix timestamp (midnight of event day)
  slot_duration_mins INTEGER NOT NULL DEFAULT 90,
  notes TEXT,                   -- internal admin notes
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','full','cancelled')),
  created_at INTEGER NOT NULL
);

CREATE TABLE scan_slots (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES scan_events(id) ON DELETE CASCADE,
  start_time INTEGER NOT NULL,  -- unix timestamp
  status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','reserved','completed','cancelled')),
  created_at INTEGER NOT NULL
);

CREATE TABLE scan_bookings (
  id TEXT PRIMARY KEY,
  talent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot_id TEXT NOT NULL UNIQUE REFERENCES scan_slots(id),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','cancelled','completed')),
  notes TEXT,                   -- talent notes / special requirements
  cancelled_at INTEGER,
  created_at INTEGER NOT NULL
);
```

#### API Routes
- `GET /api/bookings/events` — list upcoming events with slot availability (public to authenticated talent)
- `POST /api/bookings` — talent creates a booking for a slot
- `DELETE /api/bookings/[id]` — talent cancels a booking (>48h before slot)
- `GET /api/bookings/mine` — talent's own upcoming + past bookings
- `GET /api/admin/bookings` — admin: all bookings across all events
- `POST /api/admin/bookings/events` — admin: create a popup event with slots
- `PATCH /api/admin/bookings/slots/[id]` — admin: mark slot completed, add notes

#### UI Pages
- `/bookings` — talent-facing calendar + location cards + booking flow
- `/bookings/confirmation/[id]` — post-booking confirmation page
- `/admin/bookings` — admin event management + booking list per event

#### Email Templates
- `scanBookingConfirmedEmail` — talent booking confirmation (date, time, hotel, address, what to bring)
- `scanBookingCancelledEmail` — cancellation confirmation to talent
- `scanBookingReminderEmail` — 24h reminder to talent (triggered by scheduled Worker or cron)
- `scanUploadedEmail` — post-scan notification: "Your scan is ready in your vault"

---

### 🟣 Phase 5.7 — Production Entities & Package Metadata

Productions (films, TV shows, games, commercials) are first-class entities rather than free-text strings. This gives us deduplication, cross-licence reporting ("which productions have licensed this talent?"), and a place to hang future metadata (IMDB links, shoot dates, VFX supervisors, etc.) without schema changes.

The same pattern applies to production companies — deduplicated entities that can be enriched later.

#### Design Principles

1. **Zero-friction creation** — typing a name in the licence request form is enough to create a production or company. No separate "create" step required.
2. **Suggest-on-type** — as the user types, an autocomplete dropdown shows matching existing entities. Selecting one links the licence to that entity. Typing a new name creates a new entity on submit.
3. **Enrich later** — admin and rep users can add metadata to productions and companies from dedicated detail pages. The entity is useful from the moment it's created with just a name.
4. **Backwards-compatible** — existing licences with free-text `project_name` / `production_company` are migrated into the new tables. No data loss.

---

#### DB Schema

**Migration — `0012_productions.sql`:**

```sql
-- Production companies (studios, VFX houses, ad agencies)
CREATE TABLE production_companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  website TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX idx_production_companies_name ON production_companies(name COLLATE NOCASE);

-- Productions (films, TV shows, games, commercials)
CREATE TABLE productions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  company_id TEXT REFERENCES production_companies(id),
  type TEXT CHECK(type IN ('film', 'tv_series', 'tv_movie', 'commercial', 'game', 'music_video', 'other')),
  year INTEGER,                     -- release/target year
  status TEXT CHECK(status IN ('development', 'pre_production', 'production', 'post_production', 'released', 'cancelled')),
  imdb_id TEXT,                     -- e.g. "tt1234567"
  tmdb_id INTEGER,
  director TEXT,
  vfx_supervisor TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX idx_productions_name_company ON productions(name COLLATE NOCASE, company_id);

-- Link licences to production entities (nullable FKs — migration backfills these)
ALTER TABLE licences ADD COLUMN production_id TEXT REFERENCES productions(id);
ALTER TABLE licences ADD COLUMN production_company_id TEXT REFERENCES production_companies(id);
```

**Migration strategy:**
1. Create tables and add nullable FK columns to `licences`
2. Run a backfill: for each distinct `(project_name, production_company)` pair in `licences`, insert into `production_companies` (deduplicated by name) and `productions`, then set the FK columns
3. New licence creation always populates the FK columns
4. Legacy `project_name` / `production_company` text columns remain for now (read fallback) — can be dropped in a future migration once all reads use the FK

---

#### Scan Package Metadata (extended)

**Migration — `0013_package_metadata.sql`:**

```sql
-- Extended metadata for scan packages — all optional, enriched post-upload
ALTER TABLE scan_packages ADD COLUMN scan_type TEXT CHECK(scan_type IN ('light_stage', 'photogrammetry', 'lidar', 'structured_light', 'other'));
ALTER TABLE scan_packages ADD COLUMN resolution TEXT;            -- e.g. "8K", "4K"
ALTER TABLE scan_packages ADD COLUMN polygon_count INTEGER;      -- mesh complexity
ALTER TABLE scan_packages ADD COLUMN color_space TEXT;           -- e.g. "ACES", "sRGB", "Linear"
ALTER TABLE scan_packages ADD COLUMN has_mesh INTEGER DEFAULT 0;
ALTER TABLE scan_packages ADD COLUMN has_texture INTEGER DEFAULT 0;
ALTER TABLE scan_packages ADD COLUMN has_hdr INTEGER DEFAULT 0;
ALTER TABLE scan_packages ADD COLUMN has_motion_capture INTEGER DEFAULT 0;
ALTER TABLE scan_packages ADD COLUMN compatible_engines TEXT;    -- JSON: ["unreal", "unity", "maya", "blender"]
ALTER TABLE scan_packages ADD COLUMN tags TEXT;                  -- JSON: ["full_body", "face_only", "hands", "dental"]
ALTER TABLE scan_packages ADD COLUMN internal_notes TEXT;        -- admin/talent notes not shown to licensees
```

These fields power the capabilities badges on the Digital Actor Card (§P0.2) and enable licensees to filter the directory by technical requirements.

---

#### API Routes

**Productions & Companies — autocomplete + CRUD:**

| Method | Route | Description | Auth |
|---|---|---|---|
| `GET` | `/api/productions/search?q=` | Autocomplete search — returns top 10 matching productions by name (case-insensitive prefix match). Includes `company.name` in response. | Any authenticated |
| `GET` | `/api/production-companies/search?q=` | Autocomplete search — returns top 10 matching companies by name | Any authenticated |
| `POST` | `/api/productions` | Create a production (name required, all else optional). If `companyName` is provided and no `companyId`, auto-creates the company. | Any authenticated |
| `GET` | `/api/productions/[id]` | Get production detail with all metadata + linked licences count | Any authenticated |
| `PATCH` | `/api/productions/[id]` | Update production metadata (name, type, year, status, IMDB, etc.) | Admin, Rep |
| `GET` | `/api/production-companies/[id]` | Get company detail with linked productions | Any authenticated |
| `PATCH` | `/api/production-companies/[id]` | Update company metadata | Admin, Rep |

**Scan Package Metadata:**

| Method | Route | Description | Auth |
|---|---|---|---|
| `GET` | `/api/vault/packages/[id]/metadata` | Get extended package metadata | Talent, Rep (own), Admin |
| `PATCH` | `/api/vault/packages/[id]/metadata` | Update extended package metadata fields | Talent, Rep (own), Admin |

---

#### UI Pages

**Production Detail — `/admin/productions`:**
- Searchable/filterable list of all productions in the system
- Columns: Name, Company, Type, Year, Status, Licences (count), Created
- Click through to detail page

**Production Detail — `/admin/productions/[id]`:**
- Editable form with all metadata fields (type, year, status, IMDB/TMDB ID, director, VFX supervisor, notes)
- Linked company (autocomplete to change)
- List of all licences associated with this production (talent name, package, status, fee)
- "Merge" action — combine duplicate productions (reassigns all licences to the target)

**Company Detail — `/admin/productions/companies`:**
- Same pattern: searchable list → detail page with editable metadata + linked productions

**Licence Request Form — updated Step 1 (Project Details):**
- `projectName` text input → **autocomplete input** that searches `/api/productions/search`
  - Dropdown shows matching productions with company name and year
  - Selecting one populates `productionId` and auto-fills `productionCompany`
  - Typing a new name that doesn't match → creates a new production on submit
- `productionCompany` text input → **autocomplete input** that searches `/api/production-companies/search`
  - Same pattern: suggest existing, create new on submit
- Visual indicator when linking to an existing entity vs creating new (e.g. subtle "New" badge)

**Scan Package Metadata — `/vault/packages/[id]/metadata`:**
- Editable form accessible from the package card in the vault dashboard (pencil/edit icon)
- Sections:
  - **Scan Details** — scan type (dropdown), resolution, polygon count, color space
  - **Capabilities** — toggle switches: has mesh, has texture, has HDR, has motion capture
  - **Compatibility** — multi-select: Unreal, Unity, Maya, Blender, Houdini, etc.
  - **Tags** — tag input: full body, face only, hands, dental, etc.
  - **Internal Notes** — textarea (not visible to licensees)
- Auto-save on field change (debounced PATCH) or explicit Save button
- Talent and reps can edit their own packages; admins can edit any

---

#### Autocomplete Component

A shared `<Autocomplete>` component used across the licence request form and admin pages:

```
┌─────────────────────────────────────────┐
│ The Ody...                              │
├─────────────────────────────────────────┤
│ 🎬 The Odyssey (2025) — Universal       │  ← existing match
│ 🎬 The Odyssey Returns — Netflix        │  ← existing match
│ ➕ Create "The Ody..." as new production │  ← always last option
└─────────────────────────────────────────┘
```

- Debounced search (300ms) on keystroke
- Minimum 2 characters before searching
- Keyboard navigable (arrow keys + enter)
- Shows entity type icon + name + disambiguating context (company, year)
- "Create new" option always visible at bottom when input doesn't exactly match an existing entity

---

#### Migration Path (existing data)

1. Deploy migration `0012_productions.sql` — creates tables + adds FK columns
2. Run backfill script (one-time):
   - `SELECT DISTINCT production_company FROM licences` → insert into `production_companies`
   - `SELECT DISTINCT project_name, production_company FROM licences` → insert into `productions` with company FK
   - `UPDATE licences SET production_id = ..., production_company_id = ...` matching on text
3. Update all reads to prefer FK join, fall back to text columns
4. Future: drop text columns once confident

---

#### Future Extensions (not in scope now)

- TMDB/IMDB lookup for productions (auto-populate metadata from external DB)
- Production contacts (VFX supervisor, line producer) as sub-entities
- Production-level access controls (all talent on a production visible to the licensee)
- Production budgets and deal tracking
- Company verification / trust levels

### 🟢 Phase 6 — Production Hardening
- [ ] Pen test
- [ ] Legal review + ToS/Privacy Policy
- [ ] Billing (Stripe)
- [ ] Observability (Logpush, error tracking)
- [ ] Load / performance testing with large files
- [ ] Custom domains per agency tenant

---

## 10. April 8 Pitch — Agency Feature Sprint

**Deadline:** April 8, 2026 — pitch to United Agents (and potentially CAA/WME/UTA)
**Target audience:** Senior talent agents and agency heads
**Goal:** Demonstrate that this platform makes their talent more valuable and gives the agency complete control

### What agencies need to feel in the demo

1. **Control** — they approve every use, they set the rules, they gate every download
2. **Revenue** — this creates a new income stream they don't have today
3. **Protection** — actors' likenesses cannot be misused without active agent involvement
4. **Simplicity** — this fits how they already work (approvals, deal notes, commission splits)

### Core fear to neutralise

The number one concern will be: *"Does this make our actors replaceable?"*

Counter-narrative throughout the demo:
> "No digital use happens without your approval. This platform ensures actors are paid every time their digital likeness is used."

---

### P0 — Must-Have for Demo (Week 1–2, March 14–28)

#### P0.1 — Likeness Usage Permission Toggles

Extend `talent_settings` table with per-use-type permission flags. This is the single most powerful visual for the pitch — agents immediately see they control what their actor can and cannot be used for.

**DB migration — `0008_likeness_permissions.sql`:**
```sql
ALTER TABLE talent_settings ADD COLUMN permit_commercial INTEGER NOT NULL DEFAULT 1;        -- 0=blocked, 1=approval_required, 2=allowed
ALTER TABLE talent_settings ADD COLUMN permit_video_game INTEGER NOT NULL DEFAULT 1;
ALTER TABLE talent_settings ADD COLUMN permit_ai_avatar INTEGER NOT NULL DEFAULT 1;
ALTER TABLE talent_settings ADD COLUMN permit_training_data INTEGER NOT NULL DEFAULT 0;     -- off by default
ALTER TABLE talent_settings ADD COLUMN permit_digital_double INTEGER NOT NULL DEFAULT 1;
ALTER TABLE talent_settings ADD COLUMN permit_deepfake_monitoring INTEGER NOT NULL DEFAULT 2; -- always on by default
```

Values: `0 = blocked` | `1 = approval required` | `2 = allowed`

**UI — `/admin/talent/[talentId]` (already exists):**
- Replace the single `pipelineEnabled` toggle with a permission matrix table
- Each row: usage type, description, three-state toggle (Blocked / Approval Required / Allowed)
- Colour-coded: red = blocked, amber = approval required, green = allowed
- This is visible to agents in the rep view of a talent's settings

**API — extend `PATCH /api/admin/talent/[talentId]/settings`:**
- Accept the six new fields
- Validate 0/1/2 range
- Return full updated settings object

**Enforcement — `POST /api/licences/request`:**
- On licence creation, check the relevant `permit_*` flag against the requested `licenceType`
- If `0` (blocked): reject with 403 + "This usage type is not permitted for this talent"
- If `1` (approval required): licence created as `PENDING` (current behaviour)
- If `2` (allowed): licence created as `PENDING` (agent still reviews, but flag shown in review UI)

---

#### P0.2 — Digital Actor Card

A luxury, shareable profile page for each talent. This is the "hero moment" of the demo — click an actor and see their digital identity. Replace the existing thin `/talent/[id]` directory page.

**URL:** `/talent/[id]` (existing route, full redesign)

**Layout:**
```
┌─────────────────────────────────────────────────────────────┐
│  [AGENCY NAME]          [SCAN DATE]          [STATUS BADGE] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  [TMDB PORTRAIT]    ACTOR NAME                             │
│                     Agency: United Agents                   │
│                     Scan: Light Stage Capture               │
│                     Capture: March 2023                     │
│                                                             │
│  ── CAPABILITIES ──────────────────────────────────────     │
│  ✓ Photoreal digital double                                 │
│  ✓ Real-time mesh (Unreal / Unity)                         │
│  ✓ 360° reference capture                                   │
│  ✓ HDR lighting data                                        │
│  ✓ Facial performance capture                               │
│                                                             │
│  ── LICENSING PERMISSIONS ─────────────────────────────     │
│  Commercial ads       [APPROVAL REQUIRED]                   │
│  Video game           [ALLOWED]                             │
│  AI avatar            [APPROVAL REQUIRED]                   │
│  Training datasets    [BLOCKED]                             │
│  Digital double       [ALLOWED]                             │
│                                                             │
│  ── AVAILABLE LICENCE TYPES ───────────────────────────     │
│  [Film] [Advertising] [Games] [Digital Avatar]              │
│                                                             │
│            [REQUEST A LICENCE]                              │
└─────────────────────────────────────────────────────────────┘
```

**Capabilities** are derived from scan package metadata (file types present: EXR = HDR data, mesh files = real-time ready, 360 video = reference capture).

**Permissions** are pulled from `talent_settings` for the actor.

**Licence type buttons** link directly to the enhanced licence request wizard, pre-filling the usage type.

---

#### P0.3 — Agency Roster Dashboard (Enhanced Rep View)

The current `/roster` is a basic list. For the pitch, the rep sees an agency control centre.

**URL:** `/roster` (redesign)

**Top stat bar (4 cards):**
| Metric | Source |
|---|---|
| Actors represented | COUNT of talent linked to this rep |
| Scans in vault | SUM of scan packages across roster |
| Active licences | COUNT licences where status=APPROVED, valid_to > now |
| Revenue this year | SUM agreed_fee where approved_at >= Jan 1 current year |

**Talent grid:**
- Portrait (TMDB image if available, else initials avatar)
- Name, scan badge ("Light Stage"), capabilities tags
- Licence count + pending requests badge
- Quick-action: "View Profile" | "Requests ([n])" | "Settings"

**Pending requests banner (if any):**
- Red attention strip at top: "3 licence requests awaiting approval"
- One-click through to requests queue

**Revenue tab:**
- Table of all executed licences across the agency's roster
- Columns: Actor, Project, Usage Type, Fee, Agency Share, Date
- Totals row at bottom

---

#### ~~P0.4 — Enhanced Licence Request Wizard~~ ✅ Already built

`/licences/request/[packageId]` already has a full 5-step wizard: Usage Type tile picker with fee guidance → Project Details → Commercial Terms (territory, exclusivity, proposed fee with live breakdown) → AI & Data Terms (auto-flagged for `ai_avatar`/`training_data`, red AI notice) → Review & Declaration. No work needed here.

---

### P1 — High Impact for Demo (Week 3, March 28–April 4)

#### P1.1 — Revenue Tracking UI

Every licence shows a live revenue breakdown. Agents immediately see the financial mechanics.

**On the licence detail page (`/vault/requests/[licenceId]` and `/vault/licences`):**

```
Licence Fee Breakdown
─────────────────────────────────────────────
Agreed fee:          £120,000
  Actor (65%):       £78,000
  Agency (20%):      £24,000
  Platform (15%):    £18,000
─────────────────────────────────────────────
```

**Per-talent revenue summary on `/roster/[talentId]`:**
- Lifetime earnings (sum of agreed_fee on executed licences)
- This year's earnings
- Earnings by licence type (bar chart)
- Territory breakdown

**Platform uses existing `talentSharePct` / `agencySharePct` / `platformSharePct` from `talent_settings`.**

No new DB changes needed — calculated from existing fields.

---

#### P1.2 — Licence Pricing Guidance

When a talent or rep reviews an incoming request, show them the platform's suggested fee range for that usage type. This removes the "I don't know what to charge" paralysis.

**Suggested ranges (hardcoded, not DB-driven):**
| Licence Type | Suggested Range |
|---|---|
| Film / TV Digital Double | £50,000 – £300,000 |
| Video Game Character | £100,000 – £500,000 |
| Commercial / Advertising | £25,000 – £100,000 |
| AI Avatar | £2,000 – £50,000 per campaign |
| Training Dataset | £100,000 – £1,000,000+ |
| Monitoring Reference | £5,000 – £20,000 / yr |

**Where shown:**
1. On the talent's licence review page — next to the "Approve" flow
2. On `talent_settings` — talent/rep can set their own indicative pricing per type
3. On the licensee's request form — shown as guidance ("Typical range: £X–£Y")

---

#### P1.3 — Negotiation Notes on Licences

Agents work in notes. Every licence request should have a CRM-style notes thread.

**DB migration — `0009_licence_notes.sql`:**
```sql
CREATE TABLE licence_notes (
  id TEXT PRIMARY KEY,
  licence_id TEXT NOT NULL REFERENCES licences(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
```

**API:**
- `GET /api/licences/[id]/notes` — list notes for a licence
- `POST /api/licences/[id]/notes` — add a note

**UI — on the licence review page:**
- Notes thread below the main approval actions
- Text input + submit
- Timestamped entries with author email
- Used for: counter-offer discussion, approval conditions, internal memos

---

#### P1.4 — Cinematic Preview Mode

The existing preview panel is functional. For the pitch it needs to feel premium.

**Enhancements to the preview panel on the Digital Actor Card / vault package view:**
- **Full-screen mode** — expand the preview to fill the viewport
- **360° spin controls** — if a reference video is present, autoplay in a loop; add spin left/right arrow controls
- **Image zoom** — click to zoom on individual preview images (lightbox)
- **Mesh badge** — if mesh files present in the package, show "Real-time Mesh Available" badge
- **HDR badge** — if EXR files present, show "HDR Lighting Data"
- **"Request Licence" CTA** — floating button visible throughout the preview

---

### P2 — Demo Polish (Week 4, April 4–8)

#### P2.1 — Demo Data Seeding Script

Before the pitch, seed the demo environment with 5–8 fictional actors with realistic data. This avoids awkward "no data" states.

**Seed data spec:**

| Actor | Agency | Scan Type | Permissions | Active Licences |
|---|---|---|---|---|
| Almorah Vane | United Agents | Light Stage | Commercial=allowed, Games=approval required, AI=blocked | 2 active (Film, Advertising) |
| James Calloway | United Agents | Photogrammetry | All=approval required | 1 pending (Video Game) |
| Sara Mensah | United Agents | Light Stage + 360 | Commercial=approval required, Training=blocked | 0 (available) |
| Daniel Osei | United Agents | Photogrammetry | All=allowed except Training | 3 active |
| Ines Kovac | United Agents | Light Stage | AI=approval required, Training=blocked | 1 pending (AI Avatar) |

Each actor should have:
- A TMDB-linked profile (real actor IDs, known-for credits)
- 1–2 scan packages with realistic file structures (mesh, EXR, JPEG previews, 360 MP4)
- Realistic licence history with revenue figures
- Varied permission settings to demonstrate the control matrix

---

#### P2.2 — Likeness Monitoring Widget (MVP)

Even a partial implementation signals enormous protective value. The monitoring feature is the most emotionally resonant for agents.

**For the pitch: build a static/seeded monitoring UI, not a live detection engine.**

**DB migration — `0010_monitoring_alerts.sql`:**
```sql
CREATE TABLE monitoring_alerts (
  id TEXT PRIMARY KEY,
  talent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,         -- e.g. "Instagram", "TikTok", "YouTube"
  confidence INTEGER NOT NULL,    -- 0-100
  content_url TEXT,
  thumbnail_url TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','dismissed','actioned')),
  detected_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
```

**UI — widget on the agency roster dashboard and talent profile:**
```
┌─── Likeness Monitoring ──────────────────────────────────┐
│  ⚠ Potential misuse detected                             │
│                                                          │
│  Platform: Instagram                                     │
│  Confidence: 82%                                         │
│  Detected: 2 days ago                                    │
│  [View Content] [Dismiss] [Report]                       │
└──────────────────────────────────────────────────────────┘
```

For the demo: seed 1–2 alerts per talent. Narrative: *"The platform continuously monitors for unauthorised use of an actor's digital likeness."*

Real detection (reverse image search, AI model) is Phase 7 post-pitch.

---

#### P2.3 — Pitch Demo Environment

**URL:** `https://demo.changling.io` (or use the main prod URL with demo accounts)

**Demo accounts to create:**
| Role | Email | Password | Notes |
|---|---|---|---|
| Agency / Rep | `agent@unitedagents.demo` | secure | Sees full roster, all metrics |
| Talent | `almorah@talent.demo` | secure | Has 2 active licences, pending AI request |
| Licensee | `studio@silvergate.demo` | secure | Can request licence, sees directory |

**Demo script timing (12 min):**
| Section | Time | Screen |
|---|---|---|
| Problem framing | 1 min | Verbal — no screen |
| Agency dashboard | 1 min | `/roster` — stats, roster grid |
| Talent roster | 1 min | `/roster` — filter by capabilities |
| Digital Actor Card | 2 min | `/talent/[id]` — permissions, capabilities, licence types |
| Preview viewer | 1 min | Preview panel — 360, mesh badge, zoom |
| Licence request flow | 2 min | `/licences/request/[packageId]` — wizard steps 1–5 |
| Agent approval + revenue | 1 min | `/vault/requests/[id]` — fee breakdown, notes |
| Monitoring | 1 min | Monitoring widget on roster dashboard |
| Revenue dashboard | 1 min | Revenue tab — lifetime earnings, split |
| Opportunity close | 1 min | Verbal |

**The wow moment:** On the licensee screen, type into the search: *"Find scans suitable for Unreal Engine game character"* — show filtered results of Unreal-ready scans. Even a metadata filter (has mesh files, has EXR) works here.

---

### Implementation Order (25 days)

| Days | Work |
|---|---|
| March 14–17 | P0.1 Likeness permission toggles (DB + API + admin UI) |
| March 17–21 | P0.2 Digital Actor Card redesign |
| March 21–24 | P0.3 Agency roster dashboard enhancements |
| March 24–28 | P0.4 Enhanced licence request wizard |
| March 28–31 | P1.1 Revenue tracking UI + P1.2 Pricing guidance |
| March 31–April 3 | P1.3 Negotiation notes + P1.4 Preview enhancements |
| April 3–6 | P2.1 Demo data seeding + P2.2 Monitoring widget |
| April 6–8 | Demo rehearsal, edge case fixes, polish |

---

### Pitch Narrative — One Sentence Per Section

- **Problem:** *"Actors' likenesses are being used across AI, games and virtual production — but there's no licensing infrastructure."*
- **Solution:** *"The digital identity vault for talent — secure storage, licensing and protection."*
- **Control:** *"No digital use happens without your approval."*
- **Revenue:** *"Every licence tracked automatically — actors and agencies see revenue instantly."*
- **Protection:** *"The platform monitors for unauthorised use of an actor's digital likeness."*
- **Close:** *"Every actor will soon have a digital double. This platform ensures agencies control that future."*

### Key Answers to Agent Questions

| Question | Answer |
|---|---|
| Who owns the scans? | The actor. Always. The platform holds zero ownership. |
| Who controls licensing rights? | The agency and talent. Every use requires explicit approval. |
| Can scans be copied? | Downloads are dual-custody gated, watermarked, and logged. Every access event is audited. |
| How do you prevent AI misuse? | Training datasets are blocked by default. Detection monitoring flags unauthorised use. |
| How do agencies make money? | Commission on every licence — typically 15–20% of agreed fee, tracked automatically. |
| What happens if an actor leaves the agency? | Delegation is revoked. The talent retains their vault. The agency loses access immediately. |

---

## 11. In-App Notification Centre

Lightweight, poll-based notification system stored in D1. No WebSockets — notifications are fetched on page load and periodically via client-side polling. Complements existing Resend email notifications with an in-app feed.

### 11.1 Notification Events

| Event | Recipients | Click-through |
|---|---|---|
| Licence requested | Talent, Rep | `/vault/requests/[licenceId]` |
| Licence approved | Licensee | `/licences` |
| Licence denied | Licensee | `/licences` |
| Download initiated | Talent | `/vault/licences` |
| Download completed | Talent, Licensee | `/vault/licences` or `/licences/[licenceId]/download` |
| Rep delegation request | Talent | `/settings/delegation` |
| Access window expiring soon | Talent | `/vault/licences` |
| Access window download | Talent | `/vault/licences` |
| Package upload complete | Talent, Rep | `/vault` |

Notifications are created server-side by the existing API routes that handle these events (licence creation, approval, download completion, etc.). Each event inserts one row per recipient into the `notifications` table.

### 11.2 UI

**Bell icon in nav:**
- Displayed in the top nav bar for all authenticated users
- Unread count badge (red circle with number) — hidden when zero
- Badge count fetched on page load and every 60 seconds via `GET /api/notifications?unread=true&limit=0` (returns count only)

**Dropdown panel:**
- Opens on bell click — shows the 20 most recent notifications
- Each row: icon (by event type), message text, relative timestamp ("2h ago"), read/unread indicator (dot)
- Unread items have a subtle background highlight
- Click a notification: navigates to the click-through URL and marks it as read
- "Mark all read" link at the top of the panel
- "View all" link at the bottom — navigates to a full `/notifications` page (stretch, not required for V1)

### 11.3 API Routes

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/notifications` | List notifications for the authenticated user. Query params: `limit` (default 20), `offset`, `unread` (boolean filter). Returns `{ notifications, unreadCount }`. |
| `PATCH` | `/api/notifications/[id]` | Mark a single notification as read. Body: `{ read: true }`. Returns 204. |
| `POST` | `/api/notifications/read-all` | Mark all notifications as read for the authenticated user. Returns 204. |

All routes are scoped to the authenticated user's ID from the JWT. No user can read or modify another user's notifications.

### 11.4 DB Schema

**Migration — `0026_notifications.sql`:**

```sql
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  href TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_notifications_user_unread ON notifications(user_id, read, created_at DESC);
CREATE INDEX idx_notifications_user_created ON notifications(user_id, created_at DESC);
```

- `type` — one of: `licence_requested`, `licence_approved`, `licence_denied`, `download_initiated`, `download_completed`, `rep_delegation_request`, `window_expiring`, `window_download`, `upload_complete`
- `href` — the relative URL to navigate to on click (e.g. `/vault/requests/abc123`)
- `read` — 0 = unread, 1 = read
- Composite index on `(user_id, read, created_at DESC)` for efficient unread-first queries

### 11.5 Notification Creation (Server-Side Helper)

A shared helper `lib/notifications/create.ts` inserts notification rows. Called from existing API route handlers:

```
createNotification({ userId, type, title, body?, href? })
```

Bulk variant for multi-recipient events (e.g. download completed notifies both parties):

```
createNotifications([{ userId, type, title, body?, href? }, ...])
```

No queue or background job — notifications are inserted synchronously as part of the existing request handler. D1 writes are fast enough for single-row inserts.

### 11.6 Cleanup

Notifications older than 90 days are eligible for deletion. A scheduled cleanup can be added later (Cloudflare Cron Trigger or manual admin action). Not required for V1.

---

## 12. Access Windows — Controlled Temporary Download Access

### 12.1 Problem

The dual-custody download flow is the platform's core security promise: **both talent and licensee must complete 2FA before any file leaves the vault**. This is non-negotiable for the pitch narrative ("no download happens without your involvement").

But in practice, busy actors and their reps cannot be expected to pull out their authenticator app every time a VFX team needs to re-download a scan package during a 6-week shoot. The current "pre-authorisation" feature (`preauthUntil` on licences) solves this functionally but **silently auto-completes the talent side** — which undermines the security story. If a licensee downloads and the talent never knew, that is not dual custody. That is a backdoor with a timer.

**Access Windows** replace pre-authorisation with a deliberate, visible, bounded grant of temporary access that the talent consciously opens and can close at any moment.

### 12.2 Concept

An Access Window is a time-boxed period during which a specific licensee can download files under a specific licence **without requiring talent 2FA on each download**. The licensee still completes their own 2FA every time. The key differences from the old pre-auth:

1. **Intentional ceremony** — talent opens the window via a dedicated action with 2FA confirmation, not a quiet checkbox
2. **Hard limits** — maximum duration (90 days), maximum download count, and automatic expiry
3. **Full visibility** — every download during the window is logged and the talent receives notifications
4. **Instant revocation** — talent can slam the window shut from any device, effective immediately
5. **Audit trail** — the window itself is a first-class record with its own lifecycle events
6. **No AI training** — Access Windows cannot be opened for licences with `permitAiTraining = true` (those always require per-download dual custody)

The metaphor is a hotel safe with a timed unlock: you deliberately open it, you know exactly when it closes, and you get a receipt for everything that was taken out.

### 12.3 User Stories

**Talent / Rep:**
- As a talent, I want to grant a production company a 2-week download window so they can pull files on their own schedule without interrupting my day
- As a talent, I want to see at a glance which licences have an open window and when each expires
- As a talent, I want to receive a daily summary of all downloads that happened through open windows yesterday
- As a talent, I want to close a window immediately if I change my mind, revoking all remaining access
- As a rep, I want to open and manage windows on behalf of my talent, so the actor does not need to be involved in production logistics
- As a talent, I want to set a maximum number of downloads within the window, so a production cannot pull the same files 500 times

**Licensee:**
- As a licensee, I want to request a download window so I do not have to coordinate schedules with the talent's rep every time my team needs a file
- As a licensee, I want to see clearly whether a window is active for my licence, and how much time and how many downloads remain
- As a licensee, I want to download files freely during an active window without any additional approval steps beyond my own 2FA

**Platform Admin:**
- As an admin, I want to see all open windows across the platform for security monitoring
- As an admin, I want to force-close a window if suspicious activity is detected

### 12.4 Rules & Limits

| Parameter | Value | Rationale |
|---|---|---|
| Maximum window duration | 90 days | No open-ended access; forces periodic re-evaluation |
| Default duration options | 48 hours, 1 week, 2 weeks, 1 month | Covers common production timelines |
| Custom duration | Yes, up to 90 days | Talent enters a specific date |
| Maximum downloads per window | Configurable (default: 50) | Prevents bulk scraping; talent can set lower |
| Minimum downloads per window | 1 | A window with 0 downloads is pointless |
| AI training licences | Window not available | Always requires per-download dual custody |
| Opening ceremony | Talent must complete 2FA to open | Prevents accidental or unauthorised opening |
| Closing | Instant, no 2FA required | Reducing access should have zero friction |
| Notification on each download | Yes (email, in-app when built) | Talent stays informed even if not approving |
| Daily digest | Yes, sent at 08:00 talent local time | Summary of yesterday's window activity |
| Expired window behaviour | Downloads revert to full dual custody | No grace period |
| Multiple concurrent windows | One per licence (opening a new one replaces the existing) | Keeps the mental model simple |
| Extension | Talent can extend an active window (new 2FA required) | Opens a new window from now |

### 12.5 Database Schema

**New table: `access_windows`**

This is a first-class entity, not a column on the licences table. It has its own lifecycle and audit history.

```sql
CREATE TABLE access_windows (
  id TEXT PRIMARY KEY,                    -- UUID
  licence_id TEXT NOT NULL REFERENCES licences(id) ON DELETE CASCADE,
  talent_id TEXT NOT NULL REFERENCES users(id),
  licensee_id TEXT NOT NULL REFERENCES users(id),
  opened_by TEXT NOT NULL REFERENCES users(id),  -- talent or rep who opened it
  opened_at INTEGER NOT NULL,             -- unix timestamp
  expires_at INTEGER NOT NULL,            -- unix timestamp
  max_downloads INTEGER NOT NULL DEFAULT 50,
  downloads_used INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'closed', 'expired', 'exhausted')),
  closed_by TEXT REFERENCES users(id),    -- who closed it (null if expired/exhausted)
  closed_at INTEGER,                      -- when it was closed/expired/exhausted
  close_reason TEXT,                      -- 'manual' | 'expired' | 'exhausted' | 'admin' | 'licence_revoked'
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_access_windows_licence ON access_windows(licence_id);
CREATE INDEX idx_access_windows_status ON access_windows(status) WHERE status = 'active';
CREATE INDEX idx_access_windows_talent ON access_windows(talent_id);
```

**New table: `access_window_events`**

Every significant event on a window is logged. This is the tamper-evident audit trail.

```sql
CREATE TABLE access_window_events (
  id TEXT PRIMARY KEY,
  window_id TEXT NOT NULL REFERENCES access_windows(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK(event_type IN ('opened', 'download', 'extended', 'closed', 'expired', 'exhausted')),
  actor_id TEXT REFERENCES users(id),     -- who triggered the event (null for system events like expiry)
  metadata TEXT,                          -- JSON: { fileId, filename, ip } for downloads; { newExpiresAt } for extensions
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_window_events_window ON access_window_events(window_id);
CREATE INDEX idx_window_events_type ON access_window_events(event_type);
```

### 12.6 Migration from Pre-Auth

The existing `preauthUntil` / `preauthSetBy` columns on `licences` are superseded by `access_windows`. Migration strategy:

1. Deploy migration `0027_working_windows.sql` — creates new tables
2. On first deploy, a one-time backfill creates `access_windows` rows for any licence where `preauthUntil > now()`
3. Update `licensee-2fa` route to check `access_windows` instead of `licences.preauthUntil`
4. Update `talent-2fa` route to remove pre-auth option picker; replace with "Open Access Window" CTA post-authorisation
5. Old columns remain (D1 cannot drop columns) but are no longer read or written

### 12.7 API Endpoints

| Method | Route | Description | Auth |
|---|---|---|---|
| `POST` | `/api/licences/[id]/window` | Open a new Access Window. Body: `{ duration: "48h"\|"1w"\|"2w"\|"1m"\|"custom", customExpiresAt?: number, maxDownloads?: number, code: string }`. Requires talent/rep 2FA. Closes any existing active window on this licence first. | Talent, Rep |
| `GET` | `/api/licences/[id]/window` | Get the current active window for a licence (if any). Returns window details + remaining time + remaining downloads. | Talent, Rep, Licensee (own licence) |
| `DELETE` | `/api/licences/[id]/window` | Close the active window immediately. No 2FA required. | Talent, Rep, Admin |
| `PATCH` | `/api/licences/[id]/window` | Extend the active window. Body: `{ duration, customExpiresAt?, code }`. Requires 2FA. Replaces expires_at. | Talent, Rep |
| `GET` | `/api/licences/[id]/window/activity` | List all events for the current or most recent window. Paginated. | Talent, Rep, Admin |
| `POST` | `/api/licences/[id]/window/request` | Licensee requests that a window be opened. Creates a notification to talent/rep. Body: `{ requestedDuration: "48h"\|"1w"\|"2w"\|"1m", reason: string }`. | Licensee |
| `GET` | `/api/windows/active` | List all active windows for the current user (talent: their licences; rep: their roster; admin: all). | Talent, Rep, Admin |
| `GET` | `/api/admin/windows` | Admin view of all active windows platform-wide with talent, licensee, licence details. | Admin |

### 12.8 Integration with Dual-Custody Flow

The existing `licensee-2fa` route changes behaviour when an active Access Window exists:

```
1. Licensee initiates download session
        |
2. Licensee completes their own 2FA (always required)
        |
3. System checks: is there an active Access Window for this licence?
   - Window exists AND status = 'active' AND expires_at > now AND downloads_used < max_downloads?
        |
   YES: Skip talent 2FA step
        |  - Generate download tokens
        |  - Increment downloads_used on the window
        |  - Log access_window_event (type: 'download')
        |  - Log download_event (as normal)
        |  - Send per-download notification to talent (email)
        |  - Return download tokens to licensee
        |
   NO: Fall through to standard dual-custody flow
        |  - Advance to 'awaiting_talent' step
        |  - Notify talent to complete 2FA
```

If the window becomes exhausted (downloads_used reaches max_downloads) during a download, the window status transitions to `'exhausted'` and the talent is notified. The next download attempt reverts to full dual custody.

### 12.9 Notifications

| Trigger | Recipient | Channel | Content |
|---|---|---|---|
| Window opened | Licensee | Email | "A download window has been opened for [Project]. You can download until [date]. [n] downloads remaining." |
| Window opened | Talent (confirmation) | Email | "You opened a download window for [Licensee] on [Project]. Expires [date]. Max [n] downloads." |
| Download via window | Talent | Email | "[Licensee] downloaded [n] files from [Package] via your access window. [remaining] downloads left. [Close Window]" |
| Daily digest (if any window activity) | Talent | Email (08:00 local) | "Yesterday's access window activity: [n] downloads across [m] licences. [Details link]" |
| Window closing soon (24h) | Talent + Licensee | Email | "Access window for [Project] expires in 24 hours." |
| Window closed (manual) | Licensee | Email | "The download window for [Project] has been closed by [Talent/Rep]." |
| Window expired | Talent + Licensee | Email | "The access window for [Project] has expired. Future downloads require dual-custody authorisation." |
| Window exhausted | Talent + Licensee | Email | "The access window for [Project] has reached its download limit ([n] downloads). Future downloads require dual-custody authorisation." |
| Window request (from licensee) | Talent / Rep | Email | "[Licensee] is requesting a download window for [Project]. Reason: [reason]. [Open Window] CTA button, [Ignore] link" |

### 12.10 UI

#### 12.10.1 Opening a Window (Talent / Rep)

Accessible from the licence detail page and from the "Authorise Download" page (as an alternative to one-off 2FA).

**Trigger:** "Open Access Window" button on any active licence card. Also offered during the dual-custody flow as an upsell: *"Tired of approving every download? Open a window instead."*

```
┌─── Open Access Window ────────────────────────────────────────┐
│                                                                │
│  Licence: The Odyssey — Universal Pictures                     │
│  Licensee: vfx@universalstudios.com                           │
│                                                                │
│  How long should this window stay open?                        │
│                                                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │  48 hrs  │  │  1 week  │  │ 2 weeks  │  │ 1 month  │      │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘      │
│                                                                │
│  ┌──────────────────────┐                                      │
│  │  Custom: [date picker]│                                     │
│  └──────────────────────┘                                      │
│                                                                │
│  Maximum downloads:  [ 50 ▾ ]                                  │
│                                                                │
│  ── What this means ───────────────────────────────────        │
│  • The licensee can download files under this licence          │
│    without your approval for the duration above                │
│  • You will be notified of every download                      │
│  • You can close this window at any time                       │
│  • Your 2FA is required to open this window                    │
│                                                                │
│  Enter your authenticator code to confirm:                     │
│  ┌──────────────────┐                                          │
│  │ ● ● ● ● ● ●     │                                          │
│  └──────────────────┘                                          │
│                                                                │
│  [Cancel]                              [Open Window]           │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**Mobile-first consideration:** The duration options are large tap targets (min 48px height). The 2FA code input uses `inputMode="numeric"` with auto-advance between digits. The entire flow is completable in under 10 seconds on a phone.

#### 12.10.2 Active Window Badge (Licence Card)

On the talent's licence list and the licensee's licence list, an active window shows as a coloured badge with a countdown:

```
┌─── The Odyssey — Universal Pictures ───────────────────────┐
│  Status: APPROVED            ┌──────────────────────────┐  │
│  Type: Film / Double         │  Window open             │  │
│  Fee: £120,000               │ 12 days left · 38 of 50  │  │
│  Downloads: 12               │ [Close Window]            │  │
│                              └──────────────────────────┘  │
│  [View Details]  [Window Activity]                          │
└─────────────────────────────────────────────────────────────┘
```

The badge border is green when > 7 days remain, amber when < 7 days, red when < 24 hours. Talent sees a "Close Window" button directly on the card. Licensee sees a "Window Active" indicator without close controls.

#### 12.10.3 Window Activity Feed (Talent)

Accessible from the licence detail page or the active window badge. Shows a chronological log of everything that happened during the window.

```
┌─── Access Window Activity ─────────────────────────────────┐
│  The Odyssey — Universal Pictures                           │
│  Window opened: 3 Apr 2026 · Expires: 17 Apr 2026          │
│  Downloads: 12 of 50                                        │
│                                                             │
│  ── Today ──────────────────────────────────────────────    │
│  14:32  Downloaded body_scan_v2.obj (2.3 GB)               │
│         IP: 203.0.113.42 · London, UK                       │
│                                                             │
│  14:30  Downloaded face_hdr_lighting.exr (890 MB)          │
│         IP: 203.0.113.42 · London, UK                       │
│                                                             │
│  ── Yesterday ──────────────────────────────────────────    │
│  09:15  Downloaded full_body_mesh.fbx (4.1 GB)             │
│         IP: 203.0.113.42 · London, UK                       │
│                                                             │
│  ── 3 Apr ──────────────────────────────────────────────    │
│  16:00  Window opened by agent@unitedagents.co.uk          │
│         Duration: 2 weeks · Max downloads: 50               │
│                                                             │
│                                                             │
│  [Close Window]                                             │
└─────────────────────────────────────────────────────────────┘
```

#### 12.10.4 Licensee Window Request

On the licensee's download page, if no window is active and the licence is approved:

```
┌─── Download Options ───────────────────────────────────────┐
│                                                             │
│  Standard download (dual custody)                           │
│  Both you and the talent must verify. [Start Download]      │
│                                                             │
│  ── or ──                                                   │
│                                                             │
│  Request an Access Window                                   │
│  Ask the talent to open a temporary download window         │
│  so your team can download without per-file approval.       │
│                                                             │
│  Suggested duration: [ 2 weeks ]                            │
│  Reason: [Working on VFX shots for Act 2, team needs       │
│           repeated access to reference meshes             ] │
│                                                             │
│  [Send Request]                                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### 12.10.5 Dual-Custody Upsell

When a talent completes a standard dual-custody 2FA authorisation, after success show a contextual prompt:

```
┌─── Download Authorised ────────────────────────────────────┐
│                                                             │
│  Download tokens issued to vfx@universalstudios.com.       │
│                                                             │
│  ── Save time next time? ───────────────────────────────   │
│  Open an Access Window so this licensee can download        │
│  without waiting for your approval each time.               │
│                                                             │
│  [Open a 2-Week Window]   [No thanks]                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

This replaces the old pre-auth option picker that appeared during the talent-2fa step.

#### 12.10.6 Admin Windows Dashboard

`/admin/windows` — table of all active windows platform-wide:

| Talent | Licensee | Project | Opened | Expires | Downloads | Status | Actions |
|---|---|---|---|---|---|---|---|
| Almorah Vane | Universal VFX | The Odyssey | 3 Apr | 17 Apr | 12 / 50 | Active | [Force Close] |
| Daniel Osei | Netflix Post | Glass Onion 3 | 1 Apr | 1 May | 3 / 25 | Active | [Force Close] |

### 12.11 Email Templates

**`accessWindowOpenedTalentEmail`** — confirmation to talent/rep:
- Subject: "Access window opened — [Project Name]"
- Body: Licensee name, duration, max downloads, expiry date, link to close window

**`accessWindowOpenedLicenseeEmail`** — notification to licensee:
- Subject: "Download access granted — [Project Name]"
- Body: Duration, max downloads, expiry date, link to download page

**`accessWindowDownloadEmail`** — per-download notification to talent:
- Subject: "[Licensee] downloaded files via your access window"
- Body: File names, sizes, IP, remaining downloads, link to close window

**`accessWindowDigestEmail`** — daily digest to talent (only sent if activity occurred):
- Subject: "Access window activity — [date]"
- Body: Table of downloads grouped by licence, total files, total bytes, remaining window time

**`accessWindowExpiringEmail`** — 24h warning to both parties:
- Subject: "Access window expires tomorrow — [Project Name]"
- Body: Expiry time, downloads used, link to extend (talent) or download now (licensee)

**`accessWindowClosedEmail`** — notification to licensee:
- Subject: "Access window closed — [Project Name]"
- Body: Reason (manual/expired/exhausted), next steps (request new window or use dual custody)

**`accessWindowRequestEmail`** — licensee request to talent:
- Subject: "[Licensee] is requesting a download window"
- Body: Project, requested duration, reason, [Open Window] CTA button, [Ignore] link

### 12.12 Implementation Notes

**Phase 1 (build now):**
- Migration `0027_working_windows.sql`
- `POST /api/licences/[id]/window` (open)
- `GET /api/licences/[id]/window` (read)
- `DELETE /api/licences/[id]/window` (close)
- Update `licensee-2fa` to check `access_windows` table
- Remove old pre-auth option from `talent-2fa`
- Window badge on licence cards
- Open Window modal (talent/rep)

**Phase 2 (next sprint):**
- `PATCH /api/licences/[id]/window` (extend)
- `POST /api/licences/[id]/window/request` (licensee request)
- `GET /api/licences/[id]/window/activity` (event feed)
- Window activity feed UI
- Daily digest email (requires Cloudflare Cron Trigger)
- 24h expiry warning email
- `/admin/windows` dashboard
- Dual-custody upsell prompt

---

## 13. Semantic Search — Licensee Package Discovery

### 13.1 Problem

Licensees need to find scan packages across the entire catalogue using natural language queries like _"high quality full body scan for Unreal Engine"_ or _"head closeup with studio lighting for a period drama"_. Today's search is SQL LIKE-based — it only matches exact substrings in package names, descriptions, and tag text. A query like "photorealistic hero scan" returns nothing because those words don't appear verbatim in any field.

### 13.2 Goals

1. Let licensees search the package catalogue using natural language
2. Return relevant results even when query terms don't literally match stored tags or metadata
3. Factor in all available package signals: AI tags, user tags, structured metadata, talent profile
4. Fast — keyword results appear immediately, semantic results augment progressively
5. Stay on Cloudflare free tier (Vectorize: 5M vectors / 30M queries; Workers AI embeddings: free)

### 13.3 Non-Goals

- Full-text search of scan file contents (we don't index file bytes)
- Talent-side or rep-side semantic search (they use their own vault views)
- Replacing the existing keyword search — it remains the fast primary path
- Image similarity search (future — requires CLIP embeddings of cover images)

### 13.4 Searchable Data Per Package

Each package produces a **search document** — a combined text blob used for embedding:

| Source | Fields | Example |
|--------|--------|---------|
| **Package metadata** | `name`, `description`, `scanType`, `resolution`, `polygonCount`, `colorSpace` | "Hero Head Scan — 8K textures, 2M polys, ACEScg" |
| **Structured AI tags** | Accepted `package_tags` rows: `tag` + `category` | "scan_type:full-body, quality:vfx-grade, compatibility:unreal-ready" |
| **User freeform tags** | `scanPackages.tags` JSON array | "action hero, marvel, clean shave" |
| **Structured metadata flags** | `hasMesh`, `hasTexture`, `hasHdr`, `hasMotionCapture`, `compatibleEngines` | "has mesh, has texture, has HDR, Unreal Engine, Unity" |
| **Talent profile** | `talentProfiles.fullName`, `knownFor` | "Chris Hemsworth — known for Thor, Extraction, Furiosa" |

The search document is a plaintext concatenation of these fields, structured for embedding quality:

```
Package: Hero Head Scan
Description: High-resolution head and shoulders capture for VFX
Scan type: head-only | Quality: vfx-grade | Compatibility: unreal-ready, maya-compatible
Tags: full-body, studio-neutral, frontal, head-closeup
User tags: action hero, marvel, clean shave
Features: mesh, texture, HDR | Resolution: 8K | Polys: 2M
Talent: Chris Hemsworth — known for Thor, Extraction, Furiosa
```

### 13.5 Architecture

#### Two-phase search: keyword-first, semantic-augment

```
┌─────────────────────────────────────────────────┐
│  Licensee types: "realistic head for Unreal"    │
└────────────────────┬────────────────────────────┘
                     │
          ┌──────────┴──────────┐
          ▼                     ▼
   ┌─────────────┐    ┌──────────────────┐
   │ Phase 1:    │    │ Phase 2:         │
   │ Keyword     │    │ Semantic         │
   │ (SQL LIKE)  │    │ (Vectorize)      │
   │ ⚡ instant   │    │ ~100ms           │
   └──────┬──────┘    └────────┬─────────┘
          │                    │
          ▼                    ▼
   ┌─────────────┐    ┌──────────────────┐
   │ Return      │    │ Embed query via   │
   │ immediately │    │ Workers AI, then  │
   │ to client   │    │ Vectorize kNN     │
   └─────────────┘    └────────┬─────────┘
                               │
                               ▼
                      ┌──────────────────┐
                      │ Merge & dedupe   │
                      │ against keyword  │
                      │ results, return  │
                      │ new matches only │
                      └──────────────────┘
```

The client fires both requests in parallel. Keyword results render first; semantic results patch in additional matches when they arrive.

#### Infrastructure

| Component | Service | Free Tier |
|-----------|---------|-----------|
| **Vector store** | Cloudflare Vectorize | 5M stored vectors, 30M queried vectors/month |
| **Embeddings** | Workers AI — `@cf/baai/bge-base-en-v1.5` (768 dims) | Unlimited (free tier) |
| **Query API** | Next.js edge API route | Existing Pages deployment |
| **Index worker** | Triggered on package tag/metadata changes | Existing Queue infra |

### 13.6 Vectorize Index

**Index name:** `package-search`
**Dimensions:** 768 (bge-base-en-v1.5)
**Metric:** cosine similarity

Each vector is keyed by `packageId`. Metadata stored alongside the vector for post-filtering:

```json
{
  "packageId": "uuid",
  "talentId": "uuid",
  "status": "ready",
  "scanType": "head-only",
  "hasMesh": true,
  "hasTexture": true,
  "categories": ["scan_type:head-only", "quality:vfx-grade"],
  "updatedAt": 1713100000
}
```

This allows Vectorize metadata filtering (e.g. `scanType = "full-body"`) to narrow results before kNN scoring, enabling combined faceted + semantic search.

### 13.7 Indexing Pipeline

#### When to index

| Trigger | Action |
|---------|--------|
| Package status → `ready` | Generate embedding, upsert to Vectorize |
| Tag accepted or dismissed | Re-generate embedding, upsert |
| User edits freeform tags | Re-generate embedding, upsert |
| Package metadata updated | Re-generate embedding, upsert |
| Package soft-deleted | Delete vector from Vectorize |

#### How

1. Change events publish to the existing `pipeline-jobs` queue with type `index-search`
2. Pipeline worker (or a new consumer) picks up the job:
   a. Fetch package + tags + talent profile from D1
   b. Build search document text (§13.4)
   c. Call Workers AI embedding endpoint → 768-dim vector
   d. Upsert to Vectorize with metadata
3. Backfill script for existing packages: iterate all `ready` packages, generate + upsert

#### Backfill

A one-time script (run via `wrangler` or admin API route) to index all existing packages:

```
GET /api/admin/search/reindex?confirm=true
```

Iterates all non-deleted, ready packages in batches of 50. Rate-limited to avoid hitting Workers AI limits. Returns count of indexed packages.

### 13.8 Query API

#### `GET /api/vault/packages/search`

Extend the existing route. New query parameters:

| Param | Type | Description |
|-------|------|-------------|
| `q` | string | Query text (used for both keyword and semantic) |
| `semantic` | boolean | Default `true`. Set `false` to skip semantic phase |
| `tag` | string | Existing — filter by exact tag value |
| `category` | string | Existing — filter by tag category |
| `limit` | number | Max results (default 50, max 100) |
| `offset` | number | Pagination offset |

**Response shape** (extended):

```typescript
{
  packages: Array<{
    id: string;
    name: string;
    description: string;
    talentId: string;
    status: string;
    coverImageKey: string | null;
    totalSizeBytes: number | null;
    createdAt: number;
    tags: string | null;
    structuredTags: Array<{ tag: string; category: string; status: string }>;
    // new fields:
    matchType: "keyword" | "semantic" | "both";
    relevanceScore: number | null;  // cosine similarity (0-1), null for keyword-only
  }>;
  total: number;
  semanticCount: number;  // how many results came from semantic phase
}
```

#### Parallel execution flow

```typescript
const [keywordResults, semanticResults] = await Promise.all([
  keywordSearch(db, q, filters),           // existing LIKE logic
  semanticSearch(env, q, filters, limit),  // new: embed → Vectorize kNN
]);

// Merge: keyword results first, then semantic-only results
// Deduplicate by packageId — if a package appears in both, mark as "both"
// Semantic results sorted by relevanceScore descending
```

#### Alternative: streaming endpoint

For the progressive UX (keyword results first, semantic augments later), an alternative is a **separate semantic-only endpoint**:

```
GET /api/vault/packages/search/semantic?q=...&exclude=id1,id2,id3
```

The client calls both in parallel. The `exclude` param contains IDs already returned by keyword search, so the semantic endpoint only returns new matches. This avoids blocking keyword results on the embedding call.

**Recommendation:** Use the separate endpoint approach. Simpler client logic, no server-side streaming needed, works with standard fetch.

### 13.9 Result Ranking

Results are ranked by a composite score combining multiple signals:

| Signal | Weight | Source |
|--------|--------|--------|
| **Cosine similarity** | 0.50 | Vectorize kNN score (0–1) |
| **Tag match density** | 0.20 | Fraction of query-relevant tags that are accepted on the package |
| **Recency** | 0.10 | Normalised `createdAt` (newer = higher) |
| **Completeness** | 0.10 | Count of metadata fields populated (mesh, texture, HDR, etc.) / total |
| **Talent popularity** | 0.10 | `talentProfiles.popularity` normalised (0–1) |

Keyword-only results (no cosine score) are ranked by the existing SQL ordering (recency) and placed before semantic results in the response.

### 13.10 LLM Query Expansion (Phase 2)

Phase 1 uses pure vector similarity. Phase 2 adds an **LLM query expansion** step for queries where embeddings alone may miss intent:

1. Send the natural language query + the tag vocabulary to Claude Haiku
2. LLM returns structured filters: `{ tags: ["full-body", "vfx-grade"], scanType: "full-body", mustHave: ["mesh", "texture"] }`
3. These filters are applied as Vectorize metadata pre-filters + SQL WHERE clauses
4. Combined with the embedding kNN for best of both worlds

This is the "both" approach — embeddings for fuzzy matching, LLM for precise intent extraction.

**Cost:** ~$0.001 per query (Haiku). Budget-gated via existing `checkBudget()`.

**Latency:** Adds ~200-400ms. Only triggered when `semantic=true` (default). Can be disabled per-query with `expand=false`.

### 13.11 Database Changes

**New migration:** `0031_semantic_search.sql`

```sql
-- Track when each package was last indexed for search
ALTER TABLE scan_packages ADD COLUMN search_indexed_at INTEGER;

-- Index for finding stale/unindexed packages
CREATE INDEX idx_packages_search_indexed
  ON scan_packages(search_indexed_at)
  WHERE deleted_at IS NULL AND status = 'ready';
```

No new tables needed — Vectorize stores the vectors externally.

### 13.12 Wrangler Config

Add Vectorize binding to `wrangler.toml`:

```toml
[[vectorize]]
binding = "VECTORIZE"
index_name = "package-search"
```

Create the index:

```bash
wrangler vectorize create package-search \
  --dimensions=768 \
  --metric=cosine
```

### 13.13 UI — Licensee Search

The search experience lives on the existing licensee browse/search page.

#### Search bar
- Single input field, placeholder: _"Search packages — try 'full body scan for Unreal' or 'studio-lit head closeup'"_
- Debounced (300ms) — fires keyword search on each keystroke, semantic search on pause
- Below the input: active filter chips for any `tag` or `category` filters

#### Results layout
- **Keyword results** appear immediately in the results grid
- **Semantic results** fade in below/amongst keyword results when they arrive
- Each result card shows:
  - Cover image thumbnail
  - Package name + talent name
  - Top 3 structured tags as pills
  - Match indicator: subtle label — "keyword match" / "related" (for semantic-only)
  - Relevance score as a discrete indicator (high / medium / low) rather than raw number

#### Empty state
- If no keyword results but semantic results exist: _"No exact matches — showing related packages"_
- If neither: _"No packages found. Try different search terms or browse by tag."_

#### Faceted filters (sidebar)
- Tag category accordion (scan_type, quality, compatibility, etc.)
- Each shows tag values with counts
- Selecting a filter refines both keyword and semantic results
- These are SQL-powered (existing tag filter logic), not semantic

### 13.14 Implementation Plan

#### Phase 1 — Vector search (build now)

1. **Migration** `0031_semantic_search.sql` — add `search_indexed_at` column
2. **Vectorize setup** — create index via wrangler CLI, add binding to `wrangler.toml`
3. **`lib/search/embed.ts`** — `buildSearchDocument(package, tags, talent)` and `embedText(env, text)` using Workers AI
4. **`lib/search/index.ts`** — `indexPackage(env, db, packageId)` and `removePackage(env, packageId)` — upsert/delete from Vectorize
5. **`lib/search/query.ts`** — `semanticSearch(env, query, filters, limit, excludeIds)` — embed query, Vectorize kNN, return ranked results
6. **Queue integration** — add `index-search` job type to pipeline-worker, trigger on tag/metadata changes
7. **`GET /api/vault/packages/search/semantic`** — new endpoint, licensee-only
8. **`GET /api/admin/search/reindex`** — backfill all existing packages
9. **Client** — update licensee search page to call both endpoints in parallel, merge results
10. **Ranking** — implement composite score (§13.9)

#### Phase 2 — LLM query expansion (next sprint)

11. **`lib/search/expand.ts`** — `expandQuery(env, db, query)` — Claude Haiku extracts structured filters from natural language
12. **Integrate with semantic endpoint** — apply extracted filters as Vectorize metadata pre-filters
13. **Budget gate** — wire through existing `checkBudget()` / `logAiCost()`

#### Phase 3 — Refinements (future)

14. Tag-aware autocomplete (suggest tags as user types)
15. "More like this" — re-query Vectorize with an existing package's vector
16. Cover image CLIP embeddings for visual similarity search
17. Search analytics — log queries + clicks to optimise ranking weights

### 13.15 Costs

| Component | Free Tier Limit | Expected Usage | Cost |
|-----------|----------------|----------------|------|
| Vectorize storage | 5M vectors | <10K packages | $0 |
| Vectorize queries | 30M/month | <100K queries/month | $0 |
| Workers AI embeddings | Unlimited | ~100K/month (queries + indexing) | $0 |
| Claude Haiku (Phase 2 expansion) | N/A | ~$0.001/query × 50K = $50/month | Budget-capped at $1/14 days |

Phase 1 is entirely free tier. Phase 2 LLM expansion is gated by the existing AI budget ceiling.

---

## 14. Trial Production — End-to-End Proving Ground

### 14.1 Purpose

One real production, start to finish, to prove that Image Vault works under production conditions. This section defines the three phases of a licence lifecycle as experienced by all parties, identifies platform gaps, and specifies the new features required to close them.

The trial validates:
- Can we stand up a licence and get scans into the vault fast enough for a production timeline?
- Can a VFX team draw down packages at scale via the CAS Bridge without friction?
- Can we cleanly wind down a licence with cryptographic proof that data has been scrubbed?

### 14.2 Lifecycle Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        LICENCE LIFECYCLE                                │
│                                                                         │
│  Phase 1: CAPTURE          Phase 2: VFX KICKOFF      Phase 3: WIND-DOWN│
│  ┌───────────────┐         ┌─────────────────┐       ┌────────────────┐│
│  │ Deal signed    │         │ Access window    │       │ Licence expires ││
│  │ Contract up    │         │ opened           │       │ or is revoked   ││
│  │ Licence created│────────▶│ Bridge drawdown  │──────▶│ Scrub deadline  ││
│  │ (± placeholder)│         │ Status dashboard │       │ Attestation     ││
│  │ Scans captured │         │ Integrity events │       │ Audit report    ││
│  └───────────────┘         └─────────────────┘       └────────────────┘│
│                                                                         │
│  Actors: talent/rep,        Actors: licensee/VFX,     Actors: licensee, │
│  licensee, admin            talent/rep, admin         talent/rep, admin │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### 14.3 Phase 1 — Capture

The deal is done. A production company has agreed commercial terms with the talent's agency. A contract is signed. But the scans may not exist yet — the actor might walk into the scanning facility during the first week of principal photography. The platform must handle this "deal first, scans later" reality.

#### 14.3.1 Problem: Licence Before Package

Today, a licence requires a `packageId` at creation time. This means you cannot create a licence until scans have been uploaded and a package is `ready`. In practice, deals are struck weeks or months before a scan session, and production may begin before the scans arrive.

**Solution: Placeholder Licences**

A licence can be created with `packageId = null` and a new status `AWAITING_PACKAGE`. The licence holds all deal terms (fee, territory, exclusivity, dates, contract) but is not downloadable until a package is attached.

#### 14.3.2 Licence Status Extension

Add `AWAITING_PACKAGE` to the licence status enum:

```
AWAITING_PACKAGE ──▶ PENDING ──▶ APPROVED ──▶ REVOKED
                                     │              │
                                     ▼              ▼
                                  EXPIRED        (terminal)
                                     │
                              DENIED (terminal)
```

**`AWAITING_PACKAGE`** — deal terms locked, contract uploaded, but no scan package linked yet. Cannot be approved or downloaded. Visible in admin and rep dashboards as "awaiting capture".

**Transition:** when a package is attached (`PATCH /api/licences/:id/attach-package`), status auto-advances to `PENDING` for talent/rep approval.

#### 14.3.3 New / Changed Endpoints

**`POST /api/licences`** — allow `packageId: null`
- If `packageId` is null, licence is created with status `AWAITING_PACKAGE` instead of `PENDING`
- All other fields (projectName, productionCompany, licenceType, territory, fees, dates) required as normal
- `contractUrl` should be provided at creation (the signed deal)
- Returns the licence with status `AWAITING_PACKAGE`

**`PATCH /api/licences/:id/attach-package`** — new endpoint
- Auth: talent, rep (with delegation), or admin
- Body: `{ packageId: "<uuid>" }`
- Validates: licence status is `AWAITING_PACKAGE`, package exists and is `ready`, package belongs to the talent on the licence
- Sets `packageId`, transitions status to `PENDING`
- Sends notification to licensee: "Scans are now available for review — awaiting talent approval"
- Sends notification to talent/rep: "Package attached to licence — please review and approve"

**`GET /api/licences`** — filter support
- Add `status` query param to filter by licence status
- Admin and rep views should surface `AWAITING_PACKAGE` licences prominently

#### 14.3.4 Contract Upload

Licences need a signed contract document attached. This is a lightweight file (PDF, typically < 10 MB) stored in R2 alongside scan packages but in a separate prefix.

**Storage:** `R2: contracts/{licenceId}/{filename}`

The existing `GET /api/licences/:id/contract` returns the platform's auto-generated HTML preview (used by the "Contract" button in both talent and licensee views) and is kept as-is. The signed-PDF endpoints live at a sibling path to avoid conflict:

**New endpoint: `POST /api/licences/:id/contract/file`**
- Auth: talent, rep, licensee, or admin (any party on the licence)
- Accepts: multipart form upload, field name `file` (PDF, max 20 MB)
- Stores file in R2 at `contracts/{licenceId}/{filename}` in the scans bucket
- Updates licence `contract_url`, `contract_uploaded_at`, `contract_uploaded_by`
- Supports replacing: uploading a new contract overwrites the previous
- Returns: `{ contractUrl, filename, uploadedAt }`

**New endpoint: `GET /api/licences/:id/contract/file`**
- Auth: any party on the licence (talent, rep, licensee) or admin
- Default: 302 redirect to a presigned R2 GET URL (1h expiry)
- Send `Accept: application/json` or `?format=json` to receive `{ url, expiresIn, filename }` instead
- 404 if no contract uploaded

#### 14.3.5 Scan Capture Workflow

During the trial, the physical capture session produces raw scan data that must be ingested into Image Vault. The workflow:

1. **Pre-session** — admin/rep creates the placeholder licence with deal terms
2. **Scan session** — scanning facility produces raw files (EXR, OBJ, PLY, textures)
3. **Ingest** — admin or talent uploads files via the existing multipart upload flow, creating a package
4. **QA** — admin reviews the package (file count, sizes, pipeline status if applicable)
5. **Attach** — admin or rep attaches the package to the awaiting licence
6. **Approve** — talent/rep reviews and approves the licence (existing flow)

**Operational checklist for the trial (not product features — manual steps):**
- [ ] Coordinate scan session date with talent and facility
- [ ] Verify upload bandwidth at facility (or plan for physical media transfer)
- [ ] Have admin account ready to create placeholder licence
- [ ] Pre-fill licence with all known deal terms
- [ ] Upload scans as soon as available
- [ ] Verify pipeline processing completes (validate → classify → assemble)
- [ ] Attach package and notify all parties

#### 14.3.6 Schema Changes

```sql
-- Migration: 0032_placeholder_licences.sql

-- Allow nullable packageId on licences
-- (packageId is already TEXT, just need to remove NOT NULL if present
--  and add AWAITING_PACKAGE to status check)

-- Note: D1 SQLite doesn't support ALTER COLUMN, so we handle this
-- at the application layer by allowing null packageId inserts
-- and adding AWAITING_PACKAGE to the status enum in the ORM schema.
```

Drizzle schema update in `lib/db/schema.ts`:
- `packageId` — remove `.notNull()` (allow null)
- `status` enum — add `"AWAITING_PACKAGE"` to the list
- `contractUrl` — added in migration `0034_licence_contract_url.sql` alongside `contractUploadedAt` and `contractUploadedBy`

---

### 14.4 Phase 2 — VFX Production Kickoff

The licence is approved. An access window is open. The VFX team needs to pull packages onto their servers and distribute files to artist workstations. This is the highest-throughput, most time-sensitive phase.

#### 14.4.1 The Drawdown

A typical VFX kickoff looks like:

1. **IT/pipeline lead** installs the CAS Bridge on the facility's ingest server
2. **IT/pipeline lead** registers a bridge token and device via the web UI (`/settings/bridge`)
3. **Talent/rep** opens an access window on the licence (2–4 weeks, covering the kickoff period)
4. **Bridge** pulls the grant manifest (`POST /api/bridge/packages/:id/open`)
5. **Bridge** downloads all files from the presigned R2 URLs to local cache
6. **Files** are distributed from the ingest server to artist workstations (either via facility network or additional bridge instances on each workstation)

#### 14.4.2 Bridge + Access Windows Integration — **implemented (P0.3, soft-count)**

`POST /api/bridge/packages/:packageId/open` records activity against the licence's active access window but **does not block** on count. The access window is an audit signal, not DRM — only time expiry is a hard gate.

- **No active window** → bridge open proceeds as before. Windows are optional.
- **Active window** → bridge open proceeds; `access_windows.downloads_used` is incremented by 1 and an `access_window_events` row of type `download` is written (metadata: `{ grantId, packageId, tool, deviceId }`). The `downloads_used` count continues past `max_downloads` — it is never clamped.
- **Threshold crossed** (first download that takes the count to `max_downloads` or beyond) → an additional `exhausted` event is logged for audit, and the response carries `thresholdCrossed: true` so the bridge/UI can surface a one-time warning. The window's DB status stays `active` — operators decide whether to extend or close it.
- **Window expired** (`expires_at < now`) → 403 `{ error: "access_window_expired", ... }`. This is the only count/time-related hard block.

The response shape for successful bridge opens gains an `accessWindow` key only when a window was consumed:

```json
{
  "manifest": "...",
  "signature": "...",
  "keyId": "bridge-signing-key-1",
  "grantId": "...",
  "accessWindow": {
    "remaining": 12,          // may be negative once past the soft threshold
    "exceeded": false,        // true when downloads_used > max_downloads
    "thresholdCrossed": false // true only on the single open that first crosses the cap
  }
}
```

Dual-custody flow (`licensee-2fa`) does **not** yet decrement the window — that integration is tracked separately (spec §1577-area) and is out of scope for P0.3.

Helper module: `lib/bridge/accessWindows.ts` — `resolveAccessWindow(db, licenceId, now)` + `recordAccessWindowDownload(db, {...})`.

#### 14.4.3 Gap: Bulk / Batch Bridge Opens

A large package might contain 50–200 individual scan files. The VFX team needs them all. Today, the bridge must call `POST .../open` once per package, which returns all files in the manifest. This is fine for a single package.

**Problem for trial:** If a licence covers multiple packages (via `fileScope: "all"`) or the VFX team has multiple licences, the pipeline lead needs to pull everything in one session without babysitting the bridge.

**Solution: Bridge batch endpoint**

**`POST /api/bridge/batch-open`** — new endpoint
- Auth: PAT
- Body:
```json
{
  "deviceId": "<uuid>",
  "tool": "nuke",
  "licences": [
    { "licenceId": "<uuid>", "packageId": "<uuid>" },
    { "licenceId": "<uuid>", "packageId": "<uuid>" }
  ]
}
```
- Validates each licence/package pair independently
- Returns:
```json
{
  "grants": [
    { "licenceId": "...", "packageId": "...", "grantId": "...", "manifest": "...", "signature": "...", "keyId": "..." },
    { "licenceId": "...", "packageId": "...", "error": "licence_expired", "message": "..." }
  ]
}
```
- Partial success is allowed — some grants may succeed while others fail
- Each successful grant is independently tracked in `bridge_grants`

#### 14.4.4 Gap: Download Progress Visibility

During drawdown, the talent/rep and admin need to see what is happening in near-real-time.

**Current state:** `bridge_grants` records each open, and `bridge_events` records integrity events. But there is no dashboard view aggregating this into a "what's happening right now on this licence" picture.

**Solution: Licence Activity Feed**

**`GET /api/licences/:id/activity`** — new endpoint
- Auth: talent (owner), rep (with delegation), licensee (on the licence), admin
- Returns: reverse-chronological feed of:
  - Licence state changes (created, approved, revoked, expired)
  - Access window events (opened, closed, extended, expired, exhausted)
  - Bridge grant opens (which device, which tool, how many files, timestamp)
  - Bridge integrity events (tamper, hash mismatch, etc.)
  - Download events (dual-custody downloads)
  - Contract uploads
  - Package attachment (for placeholder licences)
- Pagination: `?cursor=<timestamp>&limit=50`
- Each event includes: `type`, `timestamp`, `actor` (user display name + role), `detail` (structured JSON)

This feed powers:
- A "Licence Activity" tab on the licence detail page (talent/rep/licensee view)
- An admin "Live Activity" panel during the trial
- Future: webhook/email notifications on specific event types

#### 14.4.5 Gap: Bridge Health & Connectivity Check

The VFX team needs to know the bridge is properly connected before starting a multi-hour drawdown.

**`GET /api/bridge/health`** — new endpoint
- Auth: PAT
- Returns:
```json
{
  "status": "ok",
  "userId": "<uuid>",
  "displayName": "Pipeline Lead",
  "activeLicences": 3,
  "registeredDevices": 2,
  "activeGrants": 1,
  "serverTime": 1713100000
}
```
- Lightweight endpoint for the bridge app to call on startup and periodically to verify connectivity

#### 14.4.6 Operational Checklist — VFX Kickoff

- [ ] VFX facility IT lead has a platform account (licensee role)
- [ ] Bridge token created and securely delivered to IT lead
- [ ] Bridge app installed on ingest server, token configured
- [ ] Device registered successfully (`POST /api/bridge/devices`)
- [ ] Health check passes (`GET /api/bridge/health`)
- [ ] Talent/rep opens access window covering the kickoff period
- [ ] Bridge pulls grant manifest — verify all files present in manifest
- [ ] Bridge downloads all files — verify hashes match (no `hash_mismatch` events)
- [ ] VFX team confirms files load correctly in target DCC tools (Nuke, Maya, etc.)
- [ ] Admin monitors licence activity feed for anomalies during first 24h
- [ ] Confirm bridge status polling is working (5-min intervals, no `revoked` or `vault_locked`)

---

### 14.5 Phase 3 — Licence Wind-Down & Data Scrub

The licence reaches its `validTo` date (or is revoked early). The scans must be purged from all VFX workstations and servers. The licensee must attest that they have destroyed all copies of the raw scan data, retaining only the output product (the rendered frames, the game asset, etc.).

#### 14.5.1 The Problem

Today, when a licence expires:
- Status transitions to `EXPIRED`
- Downloads stop working
- Bridge status polling returns `expired`, and a well-behaved bridge client purges its local cache
- But there is **no verification** that the licensee actually deleted the files
- There is **no deadline** for cleanup
- There is **no formal attestation** or audit record

For high-value likeness data, "trust but don't verify" is not sufficient. The talent and their agency need a signed statement that data has been scrubbed, and the platform should make that process as frictionless as possible.

#### 14.5.2 Wind-Down Timeline

When a licence transitions to `EXPIRED` or `REVOKED`, three things happen simultaneously at T=0:

```
                 Licence expires/revoked  (T=0)
                          │
         ┌────────────────┼─────────────────┐
         ▼                ▼                 ▼
  ┌──────────────┐  ┌───────────────┐  ┌──────────────────┐
  │ Bridge push  │  │ Attestation   │  │ Licence status   │
  │ purge NOW    │  │ requested NOW │  │ → SCRUB_PERIOD   │
  │ (no poll wait│  │ (email+in-app │  │ scrubDeadline    │
  │  — immediate │  │  prompt the   │  │ = T + 14 days    │
  │  purge cmd)  │  │  licensee     │  │ Downloads blocked│
  │              │  │  immediately) │  │                  │
  └──────┬───────┘  └───────┬───────┘  └──────────────────┘
         │                  │
         ▼                  │
  Bridge attempts           │
  immediate delete.         │
  If files locked/in-use:   │
  → `file_in_use` event     │
  → `purge_partial` event   │
  → flagged in activity feed│
  Bridge retries on loop    │
  (exponential backoff)     │
  until all files purged    │
  or deadline hits.         │
                            │
                            ▼
                ┌─────────────────────────────┐
                │  SCRUB PERIOD (14 days)     │  Licensee has 14 days to submit
                │  Bridge: purging / purged   │  the human attestation covering
                │  Downloads: blocked         │  everything beyond the bridge
                └─────────────────────────────┘  (backups, copied files, etc.)
                            │
                ┌───────────┴───────────┐
                ▼                       ▼
         Attestation submitted    Deadline hits, no attestation
                │                       │
                ▼                       ▼
            CLOSED (clean)          OVERDUE ──▶ Admin escalation
```

The 14-day window is for the **human declaration**, not the bridge purge. The bridge purge starts immediately and should complete within hours (or report why it can't).

#### 14.5.3 Licence Status Extension (Wind-Down)

Add two new terminal-adjacent statuses:

| Status | Meaning |
|--------|---------|
| `SCRUB_PERIOD` | Licence has expired/been revoked. Licensee has N days to attest data deletion. No downloads. |
| `CLOSED` | Attestation received. Licence lifecycle complete. Clean audit trail. |
| `OVERDUE` | Scrub deadline passed without attestation. Requires admin follow-up. |

**Full status flow with wind-down:**

```
AWAITING_PACKAGE ──▶ PENDING ──▶ APPROVED ──▶ EXPIRED ──▶ SCRUB_PERIOD ──▶ CLOSED
                         │                       │              │
                         ▼                       ▼              ▼
                       DENIED               REVOKED ─────▶ OVERDUE
                                               │
                                               ▼
                                          SCRUB_PERIOD ──▶ CLOSED
```

**Auto-transitions:**
- `APPROVED` → `EXPIRED`: when `validTo` passes (existing)
- `EXPIRED` or `REVOKED` → `SCRUB_PERIOD`: immediate (new — triggered by the same event)
- `SCRUB_PERIOD` → `CLOSED`: when attestation is submitted
- `SCRUB_PERIOD` → `OVERDUE`: when `scrubDeadline` passes without attestation

#### 14.5.4 Scrub Attestation

The attestation is a formal, timestamped declaration by the licensee that all copies of the scan data have been deleted from all systems.

**New table: `scrub_attestations`**

```sql
CREATE TABLE scrub_attestations (
  id TEXT PRIMARY KEY,
  licence_id TEXT NOT NULL REFERENCES licences(id) ON DELETE CASCADE,
  attested_by TEXT NOT NULL REFERENCES users(id),  -- licensee user
  attested_at INTEGER NOT NULL,                     -- unix timestamp
  attestation_text TEXT NOT NULL,                    -- the declaration text (platform-provided template)
  ip_address TEXT,                                   -- IP at time of submission
  user_agent TEXT,                                   -- browser/client UA
  devices_scrubbed TEXT,                             -- JSON array of device descriptions
  bridge_cache_purged INTEGER NOT NULL DEFAULT 0,    -- 1 if bridge confirmed cache purge
  additional_notes TEXT,                              -- licensee can add context
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_scrub_attestations_licence ON scrub_attestations(licence_id);
```

**New fields on `licences` table:**

```sql
-- Add to licences table
scrub_deadline INTEGER,       -- unix timestamp: when attestation is due
scrub_attested_at INTEGER,    -- unix timestamp: when attestation was submitted (denorm for fast queries)
```

#### 14.5.5 Attestation Flow

At T=0 (expiry or revocation) the platform kicks off three things in parallel — bridge purge, attestation request, and status transition — so there is no gap between licence end and cleanup starting.

1. **Licence expires or is revoked** → status transitions immediately to `SCRUB_PERIOD`, `scrubDeadline` set to `now + 14 days` (configurable per licence)
2. **Bridge purge triggered immediately** — platform does not wait for the next poll cycle. A push signal (see 14.5.7) tells the bridge to purge now. Bridge attempts delete; if files are locked/in-use, bridge reports `file_in_use` / `purge_partial` events and retries. Platform marks `bridge_cache_purged = 1` on the pending attestation stub only once **all** files are confirmed deleted.
3. **Attestation requested immediately** — email + in-app notification at T=0: "Your licence for [package] on [production] has ended. Please delete all scan data and submit your attestation. You have 14 days (by [deadline])." The licensee can submit the attestation at any point in the window, including immediately — we do not delay the prompt.
4. **Licensee submits attestation** via web UI:
   - Reviews platform-provided declaration text (not editable — legal template)
   - Lists devices/servers where data was held
   - Confirms checkbox: "I attest that all copies of the licensed scan data have been permanently deleted"
   - Completes 2FA to sign the attestation
   - Optional: add notes (e.g., "Output renders retained per contract clause 7.2")
5. **Platform records attestation** — creates `scrub_attestation` row, sets `scrub_attested_at` on licence, transitions status to `CLOSED`
6. **Talent/rep notified** — email: "Attestation received for [production]. All scan data confirmed deleted."
7. **If deadline passes without attestation** → status transitions to `OVERDUE`, admin alerted

**Important:** the licensee can submit the attestation even if the bridge purge is still showing `purge_partial` (e.g., the VFX lead knows the in-use files are about to close). But the attestation UI warns the licensee that outstanding `file_in_use` events will be recorded on their attestation record as a caveat, and the talent-facing closure report will show them. This incentivises the licensee to resolve in-use warnings before attesting, without blocking them from closing the licence on their own schedule.

**Declaration template:**

> I, [licensee name], on behalf of [production company], hereby attest that all copies of the licensed scan data obtained under licence [licence reference] for production [production name] have been permanently deleted from all systems, servers, workstations, backups, and removable media under my control or the control of [production company]. Only output products (rendered frames, composited shots, game assets) derived from the licensed data have been retained, as permitted under the licence agreement. This attestation is made on [date] and constitutes a binding declaration.

#### 14.5.6 New Endpoints

**✅ Shipped for trial (P0.4 + P0.5):**

**`GET /api/licences/:id/scrub`** — get scrub status
- Auth: any party on licence, or admin
- Returns: `{ licenceId, status, projectName, scrubDeadline, daysRemaining, overdue, scrubAttestedAt, attestation: { attestedBy, attestedAt, attestationText, devicesScrubbed, bridgeCachePurged, additionalNotes, ipAddress } | null }`

**`POST /api/licences/:id/scrub/attest`** — submit attestation
- Auth: licensee on the licence only
- Body: `{ devicesScrubbed: ["Ingest server A", "Workstation 12", ...], additionalNotes?: string, bridgeCachePurged?: boolean, totp: "123456" }`
- Validates: licence is in `SCRUB_PERIOD` or `OVERDUE`, caller is the licensee, 2FA valid, at least one device listed
- Creates attestation, sets `scrubAttestedAt`, transitions licence to `CLOSED`
- Emails talent + any reps + admins

**`POST /api/licences/:id/scrub/extend`** — extend scrub deadline
- Auth: admin only
- Body: `{ additionalDays: 1–30, reason: "Licensee requested extension — overseas facility" }`
- Updates `scrubDeadline`, pulls `OVERDUE` back to `SCRUB_PERIOD`, emails licensee

**Deferred:**

**`GET /api/admin/scrub/overdue`** — list overdue attestations
- Auth: admin
- Returns all licences in `OVERDUE` status with days overdue, licensee contact info, and last activity
- Not blocking for trial — admin can filter `/admin/licences` by status manually. Build alongside cron-based auto-expiry in P1.

#### 14.5.7 Bridge Integration — Wind-Down

The bridge should attempt to delete files **immediately** on licence expiry — not wait for its next status poll. Polling is the fallback; push-initiated purge is the primary path.

**Push-initiated purge (primary)**

At T=0 (expiry or revocation), the platform pushes a purge command to every active bridge grant for the licence. Two mechanisms to consider:

- **Short-poll window**: immediately after licence transition, the platform sets a `purge_requested_at` timestamp on `bridge_grants` rows. The bridge's status poll (running every 5 min) picks this up. Worst case delay: one poll interval.
- **Tight-poll mode**: when a bridge grant enters scrub, the bridge is instructed (via its next status response) to switch to a 30-second poll interval until purge is confirmed complete. This gives near-real-time purge without maintaining persistent connections.

Tight-poll mode is the recommended approach — it is stateless, works through NAT/firewalls, and does not require server push infrastructure (which is awkward on Cloudflare edge). The bridge status poll becomes the purge signal channel.

**Status response during scrub:**
```json
{
  "grantId": "<uuid>",
  "status": "revoked",
  "purgeRequired": true,
  "pollIntervalSeconds": 30,
  "revokedAt": 1713100000
}
```

**Bridge purge behaviour:**

1. On first status response with `status = revoked|expired` and `purgeRequired = true`:
   - Begin deleting locally cached files immediately
   - Switch to 30-second poll interval until purge is confirmed complete server-side
   - Report progress via `bridge_events` after each batch of files
2. If a file cannot be deleted (locked by a running DCC process, open in a viewer, on read-only media):
   - Report `file_in_use` event with severity `warn` and the specific file/tool/process info
   - Retry deletion with exponential backoff (30s → 1m → 5m → 15m → 1h)
   - Continue deleting other files in parallel (partial purge is better than no purge)
3. When all files deleted: report `cache_purged` event with full summary
4. If purge stalls (same files stuck `in_use` for > 1 hour): report `purge_stalled` event at severity `critical`

**New / Extended bridge event types:**

Add these `eventType` values to `bridge_events` (extending the existing enum):

| Event type | Severity | When reported | Flagged? |
|------------|----------|---------------|----------|
| `purge_started` | info | Bridge begins scrub cleanup | No |
| `purge_partial` | info | Some files deleted, others still pending | No |
| `file_in_use` | warn | A file can't be deleted (locked/open) | **Yes — shown on activity feed and closure report** |
| `purge_stalled` | critical | Same files locked > 1 hour | **Yes — alerts admin + talent/rep** |
| `cache_purged` | info | All files confirmed deleted (existing event) | No |
| `purge_failed` | critical | Bridge could not purge (e.g., R/W filesystem issue, permission denied) | **Yes — alerts admin + talent/rep** |

Each `file_in_use` event carries detail:
```json
{
  "eventType": "file_in_use",
  "severity": "warn",
  "grantId": "<uuid>",
  "detail": {
    "filename": "hero_body_scan_v04.exr",
    "path": "scans/hero_body_scan_v04.exr",
    "sizeBytes": 4294967296,
    "lockingProcess": "Nuke13.2",
    "lockingPid": 48211,
    "attemptCount": 3,
    "nextRetryAt": 1713101800,
    "reason": "locked_by_process"
  }
}
```

**Platform-side handling of in-use events:**

- `file_in_use` events aggregate into a per-licence "outstanding in-use files" list shown on:
  - The licence activity feed (14.4.4) — prominent warning state
  - The admin trial dashboard (14.6.1) scrub tracker
  - The attestation UI — licensee sees outstanding in-use files before submitting
  - The licence closure report (14.6.3) — recorded permanently as caveats on the attestation
- `purge_stalled` and `purge_failed` trigger alerts to admin + talent/rep
- The pending attestation stub's `bridge_cache_purged` flag flips to `1` only when the final `cache_purged` event arrives (all files confirmed gone). Until then the scrub tracker shows "bridge purge: in progress — N/M files deleted, K in use"

**Grant-level purge confirmation endpoint (new):**

**`POST /api/bridge/grants/:grantId/purge-complete`** — bridge reports all files deleted
- Auth: PAT
- Body: `{ filesDeleted: 47, bytesFreed: 214748364800 }`
- Validates: caller owns the grant
- Sets `purge_completed_at` on `bridge_grants`, flips `bridge_cache_purged` on the pending attestation stub, emits a `cache_purged` event
- Returns: `{ ok: true }`

This separates "I purged everything" from the stream of progress events, giving us a clean signal for the attestation stub.

The human attestation still covers everything beyond the bridge's reach (files copied to other servers, backup tapes, removable media) — but the bridge side is now actively and immediately cleaning up the only copies it knows about.

#### 14.5.8 Operational Checklist — Wind-Down

- [ ] Confirm licence `validTo` date is correct before it fires
- [ ] Verify bridge status polling is running (will receive purge command on next poll)
- [ ] At T=0: confirm attestation request email and in-app notification fired
- [ ] At T=0: confirm bridge dropped to 30-second poll (tight-poll mode)
- [ ] Within 1 hour: check `bridge_events` for `purge_started`
- [ ] Within 4 hours: check for `cache_purged` event — if absent, review `file_in_use` events
- [ ] Investigate any `purge_stalled` or `purge_failed` events within the hour
- [ ] Send reminder email to licensee at T+7 days and T+13 days if no attestation yet
- [ ] Monitor attestation submission
- [ ] If licensee submits with outstanding `file_in_use` events: document as caveat on closure report
- [ ] If overdue (no attestation at T+14 days): admin contacts licensee directly, documents communication
- [ ] Generate licence closure report (see 14.6.3) for talent/agency records

---

### 14.6 Cross-Functional Requirements

Features and operational tooling needed to run the trial that cut across all three phases.

#### 14.6.1 Admin Operations Dashboard

During the trial, the admin team (us) needs a single view of what's happening. This is not a product feature for v1 agencies — it is an internal tool.

**`/admin/trial`** — trial operations page

Sections:
- **Active Licences** — all licences in non-terminal states, with status badges, countdown to key dates
- **Access Windows** — all open windows with remaining downloads, time left, and one-click close
- **Bridge Activity** — recent grant opens, active grants, integrity events (filterable by severity)
- **Scrub Tracker** — licences in `SCRUB_PERIOD` or `OVERDUE` with deadlines and attestation status
- **Event Timeline** — unified feed of all licence, window, bridge, and scrub events across the trial

Data source: existing tables (`licences`, `access_windows`, `bridge_grants`, `bridge_events`, `scrub_attestations`). No new tables needed — this is a read-only aggregation view.

#### 14.6.2 Email Notifications — Trial-Critical

These emails must be working before the trial starts:

| Trigger | Recipient | Template | Status |
|---------|-----------|----------|--------|
| Placeholder licence created | Licensee | `placeholderLicenceCreatedEmail` | ✅ Live |
| Package attached to licence | Licensee + talent/rep | "Scans uploaded — ready for review" | Deferred — covered by dashboard refresh during trial |
| Access window opened | Licensee | "Download window is open — [duration], [max downloads] remaining" | Deferred — no opener endpoint yet |
| Access window closing soon (24h) | Licensee + talent/rep | "Access window closes in 24 hours" | Deferred — needs cron |
| Bridge grant opened | Talent/rep | "VFX team opened package via CAS Bridge on [device]" | Deferred |
| Integrity event (warn/critical) | Admin + talent/rep | "Security alert on [package]" | Deferred |
| Licence expired / revoked | Licensee | `licenceEndedAttestationEmail` | ✅ Live (revoke path) |
| Scrub reminder (T-7, T-1) | Licensee | "Reminder: attestation due in [N] days" | Deferred — needs cron |
| Attestation submitted | Talent/rep + admin | `attestationSubmittedEmail` | ✅ Live |
| Attestation extended | Licensee | `attestationExtendedEmail` | ✅ Live |
| Attestation overdue | Admin | "OVERDUE: No attestation from [licensee] — [N] days past deadline" | Deferred — needs cron |

Templates go in `lib/email/templates.ts` following the existing pattern.

For the trial, the cron-driven reminders and the auto-expiry path can be run manually (admin triggers revoke → licensee gets the attestation email; admin monitors the `/admin/licences` dashboard for OVERDUE rows).

#### 14.6.3 Licence Closure Report

When a licence reaches `CLOSED`, generate a PDF-ready summary for the talent/agency records.

**`GET /api/licences/:id/report`**
- Auth: talent, rep, admin
- Returns: JSON (UI renders as printable page, like the existing chain-of-custody document)
- Contents:
  - Licence terms (type, territory, exclusivity, fees, dates)
  - Contract reference
  - Package details (name, file count, total size)
  - Access timeline (window opens/closes, total downloads)
  - Bridge activity summary (devices used, tools, integrity events)
  - Attestation details (who, when, devices listed, declaration text)
  - Total download count and unique devices

This becomes part of the talent's permanent record — proof that their likeness data was used according to the licence and properly cleaned up.

---

### 14.7 Schema Changes Summary

All changes for the trial production feature set:

#### 14.7.1 Migration: `0032_trial_production.sql`

```sql
-- 1. Allow placeholder licences (packageId nullable — handled in ORM, not DDL for SQLite)

-- 2. New licence statuses: AWAITING_PACKAGE, SCRUB_PERIOD, CLOSED, OVERDUE
--    (enforced in ORM enum, not CHECK constraint — SQLite limitation)

-- 3. New columns on licences
ALTER TABLE licences ADD COLUMN scrub_deadline INTEGER;
ALTER TABLE licences ADD COLUMN scrub_attested_at INTEGER;

-- 4. Scrub attestations table
CREATE TABLE scrub_attestations (
  id TEXT PRIMARY KEY,
  licence_id TEXT NOT NULL REFERENCES licences(id) ON DELETE CASCADE,
  attested_by TEXT NOT NULL REFERENCES users(id),
  attested_at INTEGER NOT NULL,
  attestation_text TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  devices_scrubbed TEXT,
  bridge_cache_purged INTEGER NOT NULL DEFAULT 0,
  additional_notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_scrub_attestations_licence ON scrub_attestations(licence_id);
```

#### 14.7.2 Drizzle Schema Updates (`lib/db/schema.ts`)

- `licences.packageId` — remove `.notNull()`
- `licences.status` — extend enum: add `"AWAITING_PACKAGE"`, `"SCRUB_PERIOD"`, `"CLOSED"`, `"OVERDUE"`
- `licences.scrubDeadline` — new `integer("scrub_deadline")`
- `licences.scrubAttestedAt` — new `integer("scrub_attested_at")`
- New table: `scrubAttestations` (as above)

---

### 14.8 New Endpoints Summary

| Endpoint | Method | Auth | Phase | Purpose |
|----------|--------|------|-------|---------|
| `/api/licences/:id/attach-package` | PATCH | Session (talent/rep/admin) | 1 | Attach package to placeholder licence |
| `/api/licences/:id/contract/file` | POST | Session (any party) | 1 | Upload signed contract PDF |
| `/api/licences/:id/contract/file` | GET | Session (any party) | 1 | Download signed contract PDF (302 → presigned URL) |
| `/api/bridge/batch-open` | POST | PAT | 2 | Batch grant manifests for multiple packages |
| `/api/bridge/health` | GET | PAT | 2 | Bridge connectivity check |
| `/api/licences/:id/activity` | GET | Session (any party) | 2 | Licence activity feed |
| `/api/licences/:id/scrub` | GET | Session (any party) | 3 | Scrub status and attestation |
| `/api/licences/:id/scrub/attest` | POST | Session (licensee) | 3 | Submit scrub attestation |
| `/api/licences/:id/scrub/extend` | POST | Session (admin) | 3 | Extend scrub deadline |
| `/api/bridge/grants/:grantId/purge-complete` | POST | PAT | 3 | Bridge confirms all files deleted |
| `/api/admin/scrub/overdue` | GET | Session (admin) | 3 | List overdue attestations |
| `/api/licences/:id/report` | GET | Session (talent/rep/admin) | 3 | Licence closure report |
| `/admin/trial` | Page | Session (admin) | All | Trial operations dashboard |

---

### 14.9 Implementation Priority

Ordered by what blocks the trial from starting:

**P0 — Must have before trial begins**
1. ✅ Placeholder licences (`AWAITING_PACKAGE` status, nullable `packageId`, attach-package endpoint)
2. ✅ Contract upload/download endpoints
3. ✅ Bridge + access window integration (download counting, exhaustion check)
4. ✅ Trial-critical email notifications (at minimum: licence created, licence ended **at T=0 with attestation prompt**, attestation submitted)
5. ✅ Scrub attestation flow (schema, endpoints, basic UI)
6. ✅ Immediate bridge purge on licence end (tight-poll mode, `purgeRequired` flag on status, `file_in_use` / `purge_partial` / `cache_purged` / `purge_started` / `purge_stalled` / `purge_failed` event types, `purge-complete` endpoint)

**P1 — Must have during trial**
6. Bridge health endpoint
7. Bridge batch-open endpoint
8. Licence activity feed
9. Admin trial operations dashboard
10. Scrub reminder emails (T-7, T-1)

**P2 — Should have for trial completeness**
11. Licence closure report
12. Overdue attestation admin view and escalation alerts
13. Access window closing-soon notification (T-24h)
14. Bridge integrity event alerts to admin/talent

### 14.10 Bridge (kyoto) Integration Notes

The web app changes in P0.3 require matching behaviour on the bridge side (`changling-vault-bridge`):

- **Soft counting**: `access_window_exhausted` is **no longer returned**. The platform counts past the threshold and surfaces a warning flag — it does not block. Remove any terminal-error handling the bridge has for that code.
- **403 with `error: "access_window_expired"`** from `POST /api/bridge/packages/:id/open` is the only window-related hard block. Treat as terminal for that licence until the talent opens a new window; surface the message to the operator.
- On a successful open, the response may contain `accessWindow: { remaining, exceeded, thresholdCrossed }`. `remaining` can be negative once the count runs past `max_downloads`. `exceeded` is a steady-state flag (remains true on every subsequent open). `thresholdCrossed` is a one-shot signal (true only on the single open that first crosses the cap) — use this to fire a one-time "you've passed the download cap" toast/email rather than spamming on every subsequent open.
- No changes required for opens against licences with no active window — the response shape is backwards compatible.

**Immediate-purge contract (P0.6, shipped):**

- `GET /api/bridge/packages/:packageId/status` responses now include three new fields per grant:
  - `purgeRequired: boolean` — true when the platform has signalled immediate purge and the bridge has not yet confirmed completion.
  - `purgeRequestedAt: number | null` — unix seconds stamped on licence end.
  - `purgeCompletedAt: number | null` — unix seconds stamped when the bridge posts purge-complete.
- The top-level status response (single grant and multi-grant) also includes `pollIntervalSeconds`. It is `30` when any grant for the caller is mid-purge, otherwise `300` (5 min default). The bridge should honour whichever interval the server returns.
- On first observing `purgeRequired: true` for a grant: begin deleting cached files immediately, emit `purge_started` via `POST /api/bridge/events`, and stay in tight-poll mode until confirmed.
- During purge, emit progress events:
  - `purge_partial` (info) — batch deleted, more to go.
  - `file_in_use` (warn) — a file is locked by a running DCC. Include `{ filename, path, sizeBytes?, lockingProcess?, lockingPid?, attemptCount, nextRetryAt, reason }` in `detail`. Retry with exponential backoff (30s → 1m → 5m → 15m → 1h). Keep deleting other files in parallel.
  - `purge_stalled` (critical) — same files stuck `in_use` > 1 hour. Alerts admin + talent/rep.
  - `purge_failed` (critical) — unrecoverable filesystem / permission failure.
- When every file for the grant is gone: `POST /api/bridge/grants/:grantId/purge-complete` with body `{ filesDeleted, bytesFreed }`. The endpoint is idempotent (second call returns `alreadyComplete: true`). On success the platform stamps `purge_completed_at`, emits a server-side `cache_purged` event, and — if all grants for the licence are purged — flips `bridge_cache_purged` on the scrub attestation (if already submitted).
- The existing `/api/bridge/events` endpoint accepts the five new event types above in addition to the prior set.

### 14.11 Success Criteria

The trial is successful if:

1. **Capture** — Licence created with deal terms before scans exist. Scans uploaded and attached within 48h of capture session. Talent approves within 24h of attachment.
2. **Kickoff** — VFX team pulls all package files via CAS Bridge in a single session with zero failed downloads and zero integrity alerts. Time from "access window opened" to "all files on workstation" < 4 hours for a typical package.
3. **Wind-down** — Bridge auto-purges on licence expiry. Licensee submits attestation within the scrub period. Licence reaches `CLOSED` with a complete audit trail.
4. **No manual intervention** — the platform handles state transitions, notifications, and access control without us needing to run SQL or manually edit records.
5. **Audit confidence** — at the end, we can generate a licence closure report that a talent agent would trust as proof their client's data was handled correctly.

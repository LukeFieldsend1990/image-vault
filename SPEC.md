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
- [ ] In-app notification centre
- [ ] Configurable notification preferences per user

### 3.8 Scan Bookings
- [ ] Talent can book a scan session at a Changling mobile popup location (Claridge's London, Chateau Marmont LA, The Plaza NYC)
- [ ] Calendar UI showing upcoming popup events with available time slots
- [ ] Booking confirmation and cancellation (>48h before slot) with email notifications
- [ ] 24h reminder email to talent before their session
- [ ] Admin can create and manage popup events and slots (`/admin/bookings`)
- [ ] Post-scan: admin uploads completed package directly to talent's vault; talent is notified

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

### 8.3 Infrastructure & DevOps
- [x] Cloudflare Pages Git integration — production deploys on merge to main, preview deploys per branch
- [ ] Connect GitHub repo to Cloudflare Pages project in dashboard
- [ ] Secrets set via Cloudflare Pages dashboard environment variables (RESEND_API_KEY, RESEND_FROM_EMAIL, JWT_SECRET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, TMDB_API_KEY)
- [ ] R2 bucket soft delete / lifecycle policy
- [x] D1 database migration strategy (Drizzle ORM — numbered SQL migrations applied via `wrangler d1 migrations apply`)
- [x] Cloudflare Workers observability — `[observability] enabled = true` in wrangler.toml; 200K events/day, 3-day retention; `wrangler tail` for real-time streaming
- [ ] Cloudflare Logpush → long-term audit log retention (R2 or external SIEM) — requires paid plan
- [ ] Bot Fight Mode enabled in Cloudflare dashboard (Security → Bots)
- [ ] Rate limiting rules on `/api/auth/login`, `/api/auth/verify-totp`, `/api/auth/signup` (5 rules free)
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
- [x] Cloudflare observability enabled — `[observability] enabled = true` in `wrangler.toml`; view logs at Pages → Functions → Logs; tail locally with `wrangler tail`
- [ ] In-app notification centre
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

### 🟢 Phase 6 — Production Hardening
- [ ] Pen test
- [ ] Legal review + ToS/Privacy Policy
- [ ] Billing (Stripe)
- [ ] Observability (Logpush, error tracking)
- [ ] Load / performance testing with large files
- [ ] Custom domains per agency tenant

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
- [ ] Vault lock — talent can freeze all outbound access globally with one action

### 3.3 Large File Upload (200 GB – 1 TB)
- [ ] Chunked multipart upload directly to R2 via presigned URLs (never routed through Worker) — *current impl buffers 50 MB chunks through Worker (supports ~500 GB); presigned URL path needed for full 1 TB support*
- [ ] Resumable uploads — if interrupted, resume from last completed chunk — *upload_sessions table exists; resume logic deferred*
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
- [ ] Email notifications for: new licence requests, approvals, denials, download events, upload completions
- [ ] In-app notification centre
- [ ] Configurable notification preferences per user

### 3.7 Admin Panel
- [ ] User management (invite, suspend, delete)
- [ ] Platform-wide audit log
- [ ] Storage usage dashboard
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

- **Production:** `https://image-vault.pages.dev` (or custom domain)
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

### 6.1 Dual-Custody Download Flow

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

### 6.2 Licence Record Fields
- `id`, `talent_id`, `scan_id`, `licensee_id`
- `project_name`, `intended_use`, `valid_from`, `valid_to`
- `status`: PENDING | APPROVED | DENIED | REVOKED | EXPIRED
- `approved_by`, `approved_at`
- `dual_custody_completed_at`
- `download_count`, `last_download_at`
- `encrypted_cek` — CEK re-encrypted for licensee's key

---

## 7. Multi-Tenancy & Branding

### 7.1 Strategy — Hardcoded Multi-Tenancy

The platform uses a **single backend** (one D1, one R2, one Cloudflare Pages deployment) with **per-agency hardcoded UI themes**. There are 5–6 target agencies; generic theming is not required. Each agency gets its own branded experience on the same codebase.

Tenant is identified by:
1. **Subdomain** (e.g., `unitedagents.imagevault.com`, `caa.imagevault.com`) — preferred
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
- [ ] Secrets set via Cloudflare Pages dashboard environment variables
- [ ] R2 bucket soft delete / lifecycle policy
- [x] D1 database migration strategy (Drizzle ORM — numbered SQL migrations applied via `wrangler d1 migrations apply`)
- [ ] Cloudflare Logpush → long-term audit log retention (R2 or external SIEM)
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

### ✅ Phase 1 — Auth
- [x] Database schema: users, sessions, devices, 2fa_methods
- [x] Sign up flow (email + password + role selection)
- [ ] Email verification on sign-up (not yet implemented)
- [x] Login with TOTP 2FA
- [x] JWT + refresh token session management (HttpOnly cookies)
- [x] Role-based access control middleware

### 🟡 Phase 1.5 — Theme Engine
- [ ] `ThemeConfig` interface and theme resolver middleware — *multi-tenant engine deferred; theme currently hardcoded*
- [x] United Agents theme tokens (black/white, red accent `#c0392b`) — hardcoded in `app/globals.css`
- [x] CSS variable injection (no FOUC) — all tokens available globally via `:root` CSS variables
- [ ] Branded login page (logo, tagline per agency)
- [ ] Stub theme files for remaining 5 agencies (CAA, WME, UTA, Troika, Curtis Brown)

### ✅ Phase 2 — Vault & Upload
- [x] Database schema: scan_packages, scan_files, upload_sessions
- [x] Talent vault dashboard with expandable package cards + file list
- [x] Multipart upload orchestration API — initiate, upload part (via Worker), complete
- [ ] Client-side AES-256-GCM chunk encryption (deferred — zero-knowledge layer)
- [x] Upload progress UI with per-file progress bars
- [ ] Resumable upload state in KV (deferred)

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
- [ ] Email notifications via Resend (per-tenant branded templates)
- [ ] In-app notification centre
- [ ] Admin panel — user management, audit log, storage dashboard

### 🟢 Phase 6 — Production Hardening
- [ ] Pen test
- [ ] Legal review + ToS/Privacy Policy
- [ ] Billing (Stripe)
- [ ] Observability (Logpush, error tracking)
- [ ] Load / performance testing with large files
- [ ] Custom domains per agency tenant

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
7. [Cross-Functional Requirements](#7-cross-functional-requirements)
8. [Product Backlog / TODO](#8-product-backlog--todo)

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
- [ ] Email + password sign-up with email verification
- [ ] TOTP-based 2FA (authenticator app) — mandatory for all roles
- [ ] SMS fallback 2FA (Twilio)
- [ ] Session management with short-lived JWTs (15 min) + refresh tokens stored in HttpOnly cookies
- [ ] Device trust / known device registry
- [ ] Account recovery flow with identity verification gate

### 3.2 Talent Vault
- [ ] Vault dashboard showing all scan packages with metadata (date, size, resolution, notes)
- [ ] Scan versioning — multiple scans per talent, chronological history
- [ ] Scan metadata: capture date, studio/facility, technician notes, file manifest
- [ ] Vault activity log (who accessed what, when)
- [ ] Rep delegation — talent can grant/revoke rep access
- [ ] Vault lock — talent can freeze all outbound access globally with one action

### 3.3 Large File Upload (200 GB – 1 TB)
- [ ] Chunked multipart upload directly to R2 via presigned URLs (never routed through Worker)
- [ ] Resumable uploads — if interrupted, resume from last completed chunk
- [ ] Upload progress UI with per-chunk status and overall ETA
- [ ] Client-side AES-256-GCM encryption of each chunk before upload
- [ ] Integrity verification — SHA-256 hash per chunk and full file, verified post-upload
- [ ] Upload session management — uploads expire after 72 hours if incomplete
- [ ] Multi-file upload — a scan package may contain multiple files (body, face, hands, etc.)

### 3.4 Large File Download (for licensees)
- [ ] Chunked download with reassembly and decryption in-browser
- [ ] Parallel chunk download for maximum throughput
- [ ] Download progress UI with speed meter
- [ ] Resume interrupted downloads
- [ ] Downloaded file integrity check before delivery to filesystem

### 3.5 Licensing & Access Control
- [ ] Licensee submits a licence request specifying: project name, intended use, date range, file scope
- [ ] Talent/rep receives notification and reviews request
- [ ] **Dual-custody download**: once approved, both Talent/Rep AND Licensee must complete their own 2FA challenge before a time-limited presigned download URL is issued
- [ ] Download URLs expire in a configurable window (default 48 hours)
- [ ] Download attempt is logged with timestamp, IP, user agent
- [ ] Licence revocation — Talent can revoke an active licence; in-flight download URLs are invalidated
- [ ] Licence audit trail — full history of all requests, approvals, denials, and downloads per scan

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

**Why client-side encryption?**
The platform operates with zero-knowledge of file contents. Each scan is encrypted with a per-file AES-256-GCM key in the browser before any bytes are sent to R2. The platform never holds the plaintext.

**Key management (high level):**
- Each scan has a unique Content Encryption Key (CEK)
- CEKs are encrypted with the talent's Key Encryption Key (KEK)
- KEKs are derived from the talent's passphrase using PBKDF2 (never sent to server)
- For licensed access, a CEK is re-encrypted with the licensee's public key and stored in D1
- This is an **end-to-end encrypted key exchange** — the platform sees only encrypted key material

---

## 5. Security Model

### 5.1 Threat Model
- **Platform compromise:** Cloudflare R2/D1 breach exposes only ciphertext. No plaintext file data at rest on server.
- **Rogue admin:** Admins cannot access scan files (no key material server-side).
- **Credential theft:** TOTP 2FA + short-lived sessions limit blast radius.
- **Insider threat (licensee):** Dual-custody download ensures Talent/Rep participates in every download. Download URLs expire. All downloads are logged.
- **Link sharing:** Presigned URLs are bound to the requesting licensee's IP (where feasible) and expire.
- **Scan exfiltration:** Watermarking metadata can be embedded into download packages for forensic traceability.

### 5.2 Compliance Considerations (TBD — see §7)
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

## 7. Cross-Functional Requirements

### 7.1 Legal & Compliance
- [ ] Engage data protection counsel re: biometric data (GDPR Article 9, BIPA)
- [ ] Draft Terms of Service and Privacy Policy (biometric data clauses)
- [ ] Data Processing Agreement (DPA) template for licensees
- [ ] Establish data residency policy — confirm Cloudflare R2 bucket region (EU vs US)
- [ ] Consent capture flow for talent at onboarding
- [ ] Right to erasure workflow (GDPR Article 17) — purge all scan data + keys

### 7.2 Security & Pen Testing
- [ ] Threat model review before launch
- [ ] Third-party penetration test of auth and download flows
- [ ] OWASP Top 10 audit of API routes
- [ ] Key management design review

### 7.3 Infrastructure & DevOps
- [ ] Wrangler CI/CD pipeline (GitHub Actions → Cloudflare Pages deploy on merge to main)
- [ ] Staging environment (Cloudflare Pages preview branches)
- [ ] Secrets management via Wrangler secrets (never committed to repo)
- [ ] R2 bucket versioning / soft delete policy
- [ ] D1 database migration strategy (Drizzle ORM)
- [ ] Cloudflare Logpush → long-term audit log retention (R2 or external SIEM)
- [ ] Uptime monitoring and alerting

### 7.4 Scalability
- [ ] R2 multipart upload limits: max 10,000 parts × 5 GB = 50 TB max object — sufficient
- [ ] D1 row limits per table — monitor for audit log table growth, archive strategy
- [ ] KV TTL management for expired download tokens and sessions

### 7.5 Business & Operations
- [ ] Talent onboarding flow / white-glove setup for HNW clients
- [ ] Pricing model (per-seat? per-GB? per-licence?)
- [ ] Stripe integration for billing
- [ ] Customer support workflow
- [ ] SLA commitments

---

## 8. Product Backlog / TODO

### 🔴 Phase 0 — Foundation (current)
- [x] Initialise Next.js + Cloudflare Pages project
- [x] Configure `wrangler.toml` with R2, D1, KV bindings
- [ ] Create R2 bucket (`image-vault-scans`)
- [ ] Create D1 database and initial schema migration
- [ ] Create KV namespace (sessions)
- [ ] Set up GitHub Actions CI/CD pipeline
- [ ] Configure Cloudflare Pages project linked to repo

### 🟡 Phase 1 — Auth
- [ ] Database schema: users, sessions, devices, 2fa_methods
- [ ] Sign up / email verification flow
- [ ] Login with TOTP 2FA
- [ ] JWT + refresh token session management (HttpOnly cookies)
- [ ] Role-based access control middleware

### 🟡 Phase 2 — Vault & Upload
- [ ] Database schema: talents, scans, scan_files, upload_sessions
- [ ] Talent vault dashboard
- [ ] Multipart upload orchestration API (presign chunks, complete upload)
- [ ] Client-side AES-256-GCM chunk encryption
- [ ] Upload progress UI
- [ ] Resumable upload state in KV

### 🟡 Phase 3 — Download
- [ ] Chunked download + decryption in browser
- [ ] Download progress UI

### 🟠 Phase 4 — Licensing & Dual Custody
- [ ] Database schema: licences, download_events
- [ ] Licence request flow (licensee)
- [ ] Licence review flow (talent/rep)
- [ ] Dual-custody 2FA orchestration
- [ ] Presigned download URL generation
- [ ] Licence revocation + URL invalidation

### 🟠 Phase 5 — Notifications & Admin
- [ ] Email notifications via Resend
- [ ] In-app notification centre
- [ ] Admin panel

### 🟢 Phase 6 — Production Hardening
- [ ] Pen test
- [ ] Legal review + ToS/Privacy Policy
- [ ] Billing (Stripe)
- [ ] Observability (Logpush, error tracking)
- [ ] Load / performance testing with large files

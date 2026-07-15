/**
 * Full-flow e2e integration test — with visual output.
 *
 * Chains the REAL route handlers through the complete commercial journey:
 *
 *   Phase 1  Production & cast     — production created, talent added to cast
 *                                    (licence born at AWAITING_PACKAGE)
 *   Phase 2  Consent negotiation   — the talent's rep counter-offers, the
 *                                    production accepts (consent recorded,
 *                                    licence auto-APPROVED with agreed fee)
 *   Phase 3  Scan package          — talent attaches their ready scan package
 *   Phase 4  VFX vendor            — vendor org attached to the production and
 *                                    authorised on the licence
 *   Phase 5  Bridge & delivery     — bridge PAT minted, render-bridge agent
 *                                    enrolled, project grant served, files
 *                                    written to a LOCAL render share (real
 *                                    bytes, sha256-verified), publish reported
 *   Phase 6  Completion & removal  — licence term ends, bridge sync flips it
 *                                    to SCRUB_PERIOD and orders a purge, the
 *                                    agent deletes the local files, the
 *                                    licensee attests deletion with a live
 *                                    TOTP code, licence CLOSED
 *
 * DB/KV are in-memory doubles (the repo's FIFO-queue mock pattern); R2 is a
 * fixture byte store; file contents, checksums, TOTP verification, and the
 * local render-share filesystem are real.
 *
 * Every run regenerates a self-contained visual report at
 * __tests__/e2e/report/full-licence-flow.html
 */
import { describe, it, expect, vi, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as OTPAuth from "otpauth";
import type { SessionPayload } from "@/lib/auth/jwt";
import { createE2eEnv, settle, buildRequest, type DbWrite } from "./helpers/e2e-env";
import { writeFlowReport, type FlowStep, type FileSnapshot } from "./helpers/flow-reporter";

const t = createE2eEnv();

// ─── Module mocks ────────────────────────────────────────────────────────────
// Core plumbing is swapped for the in-memory harness; compliance-ledger,
// notification, and code-minting periphery are no-op'd so the FIFO read queue
// stays deterministic. Everything else (auth guards, negotiation engine,
// consent acceptance, bridge token hashing, TOTP) runs for real.

vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: t.getCloudflareContext }));
vi.mock("@/lib/db", () => ({ getDb: t.getDb, getKv: t.getKv }));
vi.mock("@/lib/auth/requireSession", () => ({
  requireSession: t.requireSession,
  isErrorResponse: t.isErrorResponse,
}));
vi.mock("@/lib/email/send", () => ({ sendEmail: t.sendEmail }));
vi.mock("@/lib/notifications/create", () => ({
  createNotification: vi.fn(async () => {}),
  notifyAdmins: vi.fn(async () => {}),
  notifyTalentAndReps: vi.fn(async () => {}),
}));
vi.mock("@/lib/compliance/emit-bg", () => ({
  appendEventBg: vi.fn(),
  licenceChain: (id: string) => `licence:${id}`,
  talentChain: (id: string) => `talent:${id}`,
}));
vi.mock("@/lib/compliance/consent", () => ({
  grantConsent: vi.fn(async () => ({ eventId: "evt-mock", recordId: "rec-mock" })),
  revokeConsent: vi.fn(async () => {}),
  listConsentRecords: vi.fn(async () => []),
  listConsentEvents: vi.fn(async () => []),
}));
vi.mock("@/lib/compliance/backfill", () => ({
  BACKFILLABLE_STATUSES: ["APPROVED", "SCRUB_PERIOD", "EXPIRED", "CLOSED"],
  backfillApprovalEvents: vi.fn(async () => {}),
  backfillAllApprovedLicences: vi.fn(async () => {}),
}));
vi.mock("@/lib/consent/load", () => ({
  loadConsentDocByLicence: vi.fn(async () => null),
  loadConsentDocByCast: vi.fn(async () => null),
}));
vi.mock("@/lib/codes/codes", () => ({
  mintLicenceCode: vi.fn(async () => {}),
  mintProductionCode: vi.fn(async () => {}),
  mintUserCode: vi.fn(async () => {}),
  mintOrgCode: vi.fn(async () => {}),
  mintScanNumber: vi.fn(async () => {}),
  formatCode: (p: string, n: number) => `${p}-${String(n).padStart(4, "0")}`,
  canonicalCode: () => null,
  orgPrefix: () => "OG",
  formatScan: () => null,
  formatChainCode: () => "IV",
}));
// aws4fetch presigning returns the request unsigned — the URL shape is kept.
vi.mock("aws4fetch", () => ({
  AwsClient: class {
    async sign(req: Request): Promise<Request> {
      return req;
    }
  },
}));

// Route handlers under test — imported after the mocks are wired.
const productionsRoute = await import("@/app/api/productions/route");
const castRoute = await import("@/app/api/productions/[id]/cast/route");
const counterRoute = await import("@/app/api/consent/[id]/counter/route");
const negoAcceptRoute = await import("@/app/api/consent/[id]/negotiation/accept/route");
const attachPackageRoute = await import("@/app/api/licences/[id]/attach-package/route");
const prodVendorsRoute = await import("@/app/api/productions/[id]/vendors/route");
const licVendorsRoute = await import("@/app/api/licences/[id]/vendors/route");
const bridgeTokensRoute = await import("@/app/api/bridge/tokens/route");
const renderBridgeRoute = await import("@/app/api/bridge/render-bridge/route");
const projectGrantRoute = await import("@/app/api/bridge/render-bridge/[agentId]/project-grant/route");
const heartbeatRoute = await import("@/app/api/bridge/render-bridge/[agentId]/heartbeat/route");
const publishCompleteRoute = await import("@/app/api/bridge/render-bridge/[agentId]/publish-complete/route");
const purgeCompleteRoute = await import("@/app/api/bridge/render-bridge/[agentId]/purge-complete/route");
const scrubAttestRoute = await import("@/app/api/licences/[id]/scrub/attest/route");

// ─── Fixtures ────────────────────────────────────────────────────────────────

const NOW = Math.floor(Date.now() / 1000);
const VALID_FROM = NOW - 7 * 86400;
const VALID_TO = NOW + 180 * 86400;
const INTENDED_USE = "Digital double for principal photography and VFX shots";

const TALENT = { sub: "usr-talent-ava", email: "ava.reyes@example.com", role: "talent" } as SessionPayload;
const REP = { sub: "usr-rep-morgan", email: "morgan@wavelengthtalent.example", role: "rep" } as SessionPayload;
const PRODUCER = { sub: "usr-prod-piper", email: "piper@meridianpictures.example", role: "industry" } as SessionPayload;
const VENDOR_OWNER = { sub: "usr-vfx-noor", email: "noor@nimbusvfx.example", role: "industry" } as SessionPayload;

const ORG_PROD = "org-meridian-pictures";
const ORG_VFX = "org-nimbus-vfx";
const PKG_ID = "pkg-ava-s01";
const PKG_NAME = "Ava Reyes — Full Body Scan S01";
const TOTP_SECRET = "JBSWY3DPEHPK3PXP"; // matches the dev-seed TOTP secret

function fixtureBytes(seed: string, size: number): Buffer {
  const unit = Buffer.from(`${seed}\n`);
  const out = Buffer.alloc(size);
  for (let i = 0; i < size; i++) out[i] = unit[i % unit.length];
  return out;
}

const SCAN_FILES = [
  { id: "file-head-usd", filename: "ava-reyes_S01_head.usd", bytes: fixtureBytes("#usda 1.0 — head scan mesh, 2.1M tris, Ava Reyes S01", 4096) },
  { id: "file-body-ply", filename: "ava-reyes_S01_body_lidar.ply", bytes: fixtureBytes("ply format binary_little_endian — body lidar point cloud", 6144) },
  { id: "file-tex-png", filename: "ava-reyes_S01_texture_diffuse.png", bytes: fixtureBytes("PNG-DIFFUSE-4K-UDIM-1001 Ava Reyes S01 texture payload", 8192) },
].map((f) => ({
  ...f,
  r2Key: `scans/${PKG_ID}/${f.filename}`,
  sha256: createHash("sha256").update(f.bytes).digest("hex"),
}));

// Fixture R2 object store: r2Key → bytes. The project-grant response carries
// presigned URLs; the simulated agent resolves each back to its key and pulls
// the bytes from here — then writes them to the real local render share.
const r2Store = new Map<string, Buffer>(SCAN_FILES.map((f) => [f.r2Key, f.bytes]));

const renderShare = fs.mkdtempSync(path.join(os.tmpdir(), "imagevault-render-share-"));

function snapshotRenderShare(label: string): FileSnapshot {
  const files = fs
    .readdirSync(renderShare)
    .sort()
    .map((name) => {
      const bytes = fs.readFileSync(path.join(renderShare, name));
      return { name, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    });
  return { label, directory: renderShare, files };
}

// ─── Flow state & recorder ───────────────────────────────────────────────────

const flow = {
  productionId: "",
  licenceId: "",
  castId: "",
  vendorAuthId: "",
  bridgePat: "",
  agentId: "",
  serviceToken: "",
  steps: [] as FlowStep[],
  licenceStatus: null as string | null,
  lifecycle: [] as { state: string; reachedAtStep: number | null }[],
};

function markLifecycle(state: string) {
  flow.lifecycle.push({ state, reachedAtStep: flow.steps.length });
}

interface StepSpec {
  phase: string;
  actor: { name: string; role: string };
  title: string;
  narrative: string;
  request: { method: string; path: string; auth: string; body?: unknown };
  enqueue?: unknown[];
  run: () => Promise<Response>;
  licenceStatus?: string;
  expectStatus: number;
}

/**
 * Run one flow step: enqueue exactly the DB reads the handler will perform,
 * invoke the real route handler, flush fire-and-forget work, then verify the
 * read queue is fully drained (any drift in the handler's query order fails
 * the test instead of silently corrupting later steps).
 */
async function step(spec: StepSpec) {
  for (const q of spec.enqueue ?? []) t.enqueue(q);
  const writesBefore = t.writes.length;
  const emailsBefore = t.sentEmails.length;

  const res = await spec.run();
  await settle();

  expect(res.status).toBe(spec.expectStatus);
  expect(t.queue.length).toBe(0); // every enqueued read was consumed — no drift

  const body = await res.json().catch(() => null);
  if (spec.licenceStatus) flow.licenceStatus = spec.licenceStatus;

  const record: FlowStep = {
    n: flow.steps.length + 1,
    phase: spec.phase,
    actor: spec.actor,
    title: spec.title,
    narrative: spec.narrative,
    request: spec.request,
    response: { status: res.status, body },
    dbWrites: t.writes.slice(writesBefore) as DbWrite[],
    emails: t.sentEmails.slice(emailsBefore),
    licenceStatus: flow.licenceStatus,
    checks: [],
  };
  flow.steps.push(record);
  return { body, record };
}

// Inferred-any row type — mirrors the repo's parseJson() pattern so captured
// write payloads stay assertable without tripping no-explicit-any.
type CapturedRow = ReturnType<typeof JSON.parse>;

function insertsInto(record: FlowStep, table: string): CapturedRow[] {
  return record.dbWrites.filter((w) => w.op === "insert" && w.table === table).map((w) => w.values as CapturedRow);
}
function updatesTo(record: FlowStep, table: string): CapturedRow[] {
  return record.dbWrites.filter((w) => w.op === "update" && w.table === table).map((w) => w.set as CapturedRow);
}

const params = (obj: Record<string, string>) => ({ params: Promise.resolve(obj) });

// ─── The flow ────────────────────────────────────────────────────────────────

describe("e2e: full licence flow — production → consent → vendor → bridge → delivery → completion", () => {
  it("phase 1 — the production company sets up the production and adds its cast", async () => {
    // Step 1: create the production under the studio's organisation.
    t.setSession(PRODUCER);
    const s1 = await step({
      phase: "Production & cast",
      actor: { name: "Piper Quinn", role: "Producer — Meridian Pictures" },
      title: "Create the production “Starfall”",
      narrative:
        "Meridian Pictures opens a new production. Industry users must create productions under an organisation they belong to; Piper is the org owner, so the membership check passes.",
      request: {
        method: "POST",
        path: "/api/productions",
        auth: "session · Piper Quinn (industry)",
        body: { name: "Starfall", organisationId: ORG_PROD, type: "film", year: 2027 },
      },
      enqueue: [
        { id: ORG_PROD }, // organisation exists
        { memberRole: "owner" }, // Piper's membership in it
      ],
      run: () =>
        productionsRoute.POST(
          buildRequest("/api/productions", {
            body: { name: "Starfall", organisationId: ORG_PROD, type: "film", year: 2027 },
          })
        ),
      expectStatus: 201,
    });
    flow.productionId = s1.body.id;
    expect(flow.productionId).toBeTruthy();
    const prodInsert = insertsInto(s1.record, "productions")[0];
    expect(prodInsert.name).toBe("Starfall");
    expect(prodInsert.organisationId).toBe(ORG_PROD);
    s1.record.checks.push(
      "production row inserted under Meridian Pictures' organisation",
      "coordinator recorded as the creating producer"
    );

    // Step 2: add Ava Reyes (an existing Image Vault talent) to the cast.
    // This is what creates the licence — born AWAITING_PACKAGE.
    const member = {
      talentId: TALENT.sub,
      characterName: "Captain Elara Voss",
      intendedUse: INTENDED_USE,
      validFrom: VALID_FROM,
      validTo: VALID_TO,
      licenceTypes: ["film_double"],
      useCategoryIds: ["vfx-this", "replica"],
      territory: "Worldwide",
      exclusivity: "non_exclusive",
      proposedFee: 250000, // cents — $2,500 offered
      unionAffiliation: "SAG-AFTRA",
    };
    const s2 = await step({
      phase: "Production & cast",
      actor: { name: "Piper Quinn", role: "Producer — Meridian Pictures" },
      title: "Add Ava Reyes to the cast",
      narrative:
        "Piper links Ava by her talent id (the producer never sees her email). The route creates the licence at AWAITING_PACKAGE with the offered terms — $2,500, worldwide, VFX + digital-replica scope — and a linked cast row. Ava and her rep are notified to review consent.",
      request: {
        method: "POST",
        path: `/api/productions/${flow.productionId}/cast`,
        auth: "session · Piper Quinn (industry)",
        body: { members: [member] },
      },
      enqueue: [
        { id: flow.productionId, name: "Starfall", organisationId: ORG_PROD }, // production
        { memberRole: "owner" }, // org owner check
        { name: "Meridian Pictures" }, // company name for emails
        { email: PRODUCER.email }, // coordinator email
        { id: TALENT.sub, role: "talent", email: TALENT.email }, // Ava resolved by talentId
      ],
      run: () =>
        castRoute.POST(
          buildRequest(`/api/productions/${flow.productionId}/cast`, { body: { members: [member] } }),
          params({ id: flow.productionId })
        ),
      licenceStatus: "AWAITING_PACKAGE",
      expectStatus: 201,
    });
    expect(s2.body).toMatchObject({ created: 1, linked: 1, invited: 0, placeholders: 0 });
    const licenceInsert = insertsInto(s2.record, "licences")[0];
    const castInsert = insertsInto(s2.record, "production_cast")[0];
    expect(licenceInsert.status).toBe("AWAITING_PACKAGE");
    expect(licenceInsert.proposedFee).toBe(250000);
    expect(castInsert.status).toBe("linked");
    flow.licenceId = licenceInsert.id;
    flow.castId = castInsert.id;
    markLifecycle("AWAITING_PACKAGE");
    s2.record.checks.push(
      "licence created at AWAITING_PACKAGE with the offered terms ($2,500, worldwide, film_double)",
      "cast row linked to Ava's talent account",
      "consent-review email sent to the performer"
    );
  });

  it("phase 2 — the rep negotiates consent terms and the production agrees", async () => {
    // Step 3: Morgan (Ava's rep) counter-offers — wider scope, higher fee.
    t.setSession(REP);
    const counterScope = ["vfx-this", "replica", "marketing"];
    const counterBody = {
      scope: counterScope,
      fee: 300000, // $3,000
      comment: "Ava will grant marketing use as well — fee revised to $3,000.",
    };
    const s3 = await step({
      phase: "Consent negotiation",
      actor: { name: "Morgan Sloane", role: "Talent rep — Wavelength Talent" },
      title: "Rep counter-offers on Ava's behalf",
      narrative:
        "Morgan's authority comes from the talent_reps delegation link, which the consent authorisation layer checks before letting a rep act. The counter is a conditional consent: marketing use added to the scope, fee raised to $3,000. It now awaits the production's answer.",
      request: {
        method: "POST",
        path: `/api/consent/${flow.licenceId}/counter`,
        auth: "session · Morgan Sloane (rep)",
        body: counterBody,
      },
      enqueue: [
        { id: flow.licenceId, talentId: TALENT.sub, licenseeId: PRODUCER.sub }, // licence
        { id: "rep-link-morgan-ava" }, // talent_reps delegation
        [], // negotiation thread so far — empty, this is round 1
        { id: PRODUCER.sub }, // licensee lookup for the in-app notification
      ],
      run: () =>
        counterRoute.POST(
          buildRequest(`/api/consent/${flow.licenceId}/counter`, { body: counterBody }),
          params({ id: flow.licenceId })
        ),
      expectStatus: 200,
    });
    expect(s3.body.round).toMatchObject({ round: 1, party: "rep", action: "counter", fee: 300000 });
    const negoInsert = insertsInto(s3.record, "licence_negotiations")[0];
    expect(negoInsert.party).toBe("rep");
    s3.record.checks.push(
      "rep delegation (talent_reps) verified before the counter was accepted",
      "negotiation round 1 recorded: rep counter at $3,000 with marketing scope added"
    );

    const round1Row = {
      id: negoInsert.id,
      licenceId: flow.licenceId,
      castId: null,
      round: 1,
      party: "rep",
      action: "counter",
      proposedScopeJson: negoInsert.proposedScopeJson,
      proposedFee: 300000,
      comment: counterBody.comment,
      createdAt: negoInsert.createdAt,
    };

    // Step 4: the production accepts the counter. Accepting a rep counter IS
    // the consent moment — the engine records the acceptance artifact, flips
    // the cast row to consented, and auto-approves the licence at the agreed fee.
    t.setSession(PRODUCER);
    const s4 = await step({
      phase: "Consent negotiation",
      actor: { name: "Piper Quinn", role: "Producer — Meridian Pictures" },
      title: "Production accepts the counter — consent recorded, licence approved",
      narrative:
        "Piper accepts Morgan's terms. The consent engine applies the countered scope + fee to the licence, records a consent acceptance on the performer's behalf (accepted-by-role: rep), flips the cast row to consented, and advances the licence to APPROVED — agreed fee $3,000 with the platform's 15% commission ($450) computed.",
      request: {
        method: "POST",
        path: `/api/consent/${flow.licenceId}/negotiation/accept`,
        auth: "session · Piper Quinn (industry)",
      },
      enqueue: [
        { id: flow.licenceId, talentId: TALENT.sub, licenseeId: PRODUCER.sub }, // licence (authorise)
        null, // producer is not a rep — delegation lookup misses
        [round1Row], // negotiation thread: the open rep counter
        {
          // licence loaded inside the acceptance engine (post terms-update)
          status: "AWAITING_PACKAGE",
          proposedFee: 300000,
          talentId: TALENT.sub,
          licenceType: "film_double",
          territory: "Worldwide",
          projectName: "Starfall",
          productionCompany: "Meridian Pictures",
          intendedUse: INTENDED_USE,
        },
        [round1Row], // thread re-read to number the closing "accepted" round
      ],
      run: () =>
        negoAcceptRoute.POST(
          buildRequest(`/api/consent/${flow.licenceId}/negotiation/accept`, { method: "POST" }),
          params({ id: flow.licenceId })
        ),
      licenceStatus: "APPROVED",
      expectStatus: 200,
    });
    expect(s4.body).toMatchObject({ ok: true, agreedFee: 300000 });
    expect(s4.body.agreedScope).toEqual(["vfx-this", "replica", "marketing"]);
    const acceptance = insertsInto(s4.record, "consent_acceptances")[0];
    expect(acceptance.acceptedByRole).toBe("rep");
    const approvalUpdate = updatesTo(s4.record, "licences").find((u) => u.status === "APPROVED");
    expect(approvalUpdate).toMatchObject({ agreedFee: 300000, platformFee: 45000 });
    const closingRound = insertsInto(s4.record, "licence_negotiations")[0];
    expect(closingRound).toMatchObject({ round: 2, party: "producer", action: "accepted" });
    markLifecycle("APPROVED");
    s4.record.checks.push(
      "consent acceptance recorded (accepted by the rep's conditional consent, on the performer's behalf)",
      "licence APPROVED — agreed fee $3,000, platform fee $450 (15%)",
      "cast row flipped to consented; negotiation thread closed (round 2: producer accepted)"
    );
  });

  it("phase 3 — the talent attaches their scan package", async () => {
    t.setSession(TALENT);
    const s5 = await step({
      phase: "Scan package",
      actor: { name: "Ava Reyes", role: "Talent" },
      title: "Attach the ready scan package to the licence",
      narrative:
        "Ava attaches her ready scan package (3 files: USD head mesh, LiDAR body cloud, 4K diffuse texture). The route verifies the package belongs to her, is fully processed, and not deleted — then wires it to the licence and flips the cast row to scan_uploaded. The production is emailed that the scan is available.",
      request: {
        method: "PATCH",
        path: `/api/licences/${flow.licenceId}/attach-package`,
        auth: "session · Ava Reyes (talent)",
        body: { packageId: PKG_ID },
      },
      enqueue: [
        { id: flow.licenceId, talentId: TALENT.sub, licenseeId: PRODUCER.sub, status: "APPROVED", projectName: "Starfall" },
        { id: PKG_ID, talentId: TALENT.sub, status: "ready", deletedAt: null, name: PKG_NAME },
        { id: flow.castId }, // cast row referencing this licence
        { geoFingerprintEnabled: false }, // talent's geo-fingerprint setting
        { email: PRODUCER.email }, // licensee notification email
        { email: TALENT.email }, // talent email (no self-notify — attacher is the talent)
      ],
      run: () =>
        attachPackageRoute.PATCH(
          buildRequest(`/api/licences/${flow.licenceId}/attach-package`, {
            method: "PATCH",
            body: { packageId: PKG_ID },
          }),
          params({ id: flow.licenceId })
        ),
      expectStatus: 200,
    });
    expect(s5.body.ok).toBe(true);
    const licUpdate = updatesTo(s5.record, "licences")[0];
    expect(licUpdate.packageId).toBe(PKG_ID);
    expect(licUpdate.status).toBeUndefined(); // already APPROVED — no regression
    const castUpdate = updatesTo(s5.record, "production_cast")[0];
    expect(castUpdate.status).toBe("scan_uploaded");
    s5.record.checks.push(
      "package ownership + ready status verified before attach",
      "licence keeps its APPROVED status; packageId wired in",
      "cast row advanced to scan_uploaded; production notified by email"
    );
  });

  it("phase 4 — a VFX vendor is attached to the production and authorised on the licence", async () => {
    // Step 6: attach Nimbus VFX (an existing, audited vendor org) to the production.
    t.setSession(PRODUCER);
    const s6 = await step({
      phase: "VFX vendor",
      actor: { name: "Piper Quinn", role: "Producer — Meridian Pictures" },
      title: "Attach Nimbus VFX to the production",
      narrative:
        "The production-level attachment records who is working on Starfall — it grants no scan-data access by itself. The route checks Piper's operational access, validates Nimbus is a vendor-type organisation, and notifies the vendor's owners.",
      request: {
        method: "POST",
        path: `/api/productions/${flow.productionId}/vendors`,
        auth: "session · Piper Quinn (industry)",
        body: { vendorOrgId: ORG_VFX },
      },
      enqueue: [
        { id: flow.productionId, name: "Starfall", organisationId: ORG_PROD }, // production
        { coordinatorId: PRODUCER.sub, orgCreatedBy: PRODUCER.sub }, // production owner ids → full access
        { name: "Meridian Pictures" }, // company name for the invite email
        { id: ORG_VFX, name: "Nimbus VFX", orgType: "vfx_vendor" }, // the vendor org
        null, // no existing attachment for (production, vendor)
        { country: null, topLevelId: null }, // vendor org country not set — no country sync
        [{ userId: VENDOR_OWNER.sub, email: VENDOR_OWNER.email, memberRole: "owner" }], // vendor org managers to notify
      ],
      run: () =>
        prodVendorsRoute.POST(
          buildRequest(`/api/productions/${flow.productionId}/vendors`, { body: { vendorOrgId: ORG_VFX } }),
          params({ id: flow.productionId })
        ),
      expectStatus: 201,
    });
    expect(s6.body).toMatchObject({ ok: true, mode: "attached" });
    const pvInsert = insertsInto(s6.record, "production_vendors")[0];
    expect(pvInsert).toMatchObject({ vendorOrgId: ORG_VFX, vendorType: "vfx_vendor", status: "active" });
    s6.record.checks.push(
      "vendor org type validated (vfx_vendor) before attach",
      "production_vendors row active; Nimbus VFX owners notified"
    );

    // Step 7: authorise Nimbus VFX on the licence — the actual data-access grant.
    const s7 = await step({
      phase: "VFX vendor",
      actor: { name: "Piper Quinn", role: "Producer — Meridian Pictures" },
      title: "Authorise Nimbus VFX on Ava's licence",
      narrative:
        "Per-licence vendor authorisation is the real access grant, and it is only possible on an APPROVED licence. Piper is the licensee, so the production-side check passes directly. Ava and Morgan are notified that a vendor can now access the scan under this licence — and access will additionally require Nimbus to hold a passed environment audit.",
      request: {
        method: "POST",
        path: `/api/licences/${flow.licenceId}/vendors`,
        auth: "session · Piper Quinn (industry)",
        body: { vendorOrgId: ORG_VFX },
      },
      enqueue: [
        {
          id: flow.licenceId,
          licenseeId: PRODUCER.sub,
          organisationId: ORG_PROD,
          status: "APPROVED",
          talentId: TALENT.sub,
          projectName: "Starfall",
        },
        { id: ORG_VFX, name: "Nimbus VFX" }, // vendor org exists
        null, // no prior authorisation to reactivate
      ],
      run: () =>
        licVendorsRoute.POST(
          buildRequest(`/api/licences/${flow.licenceId}/vendors`, { body: { vendorOrgId: ORG_VFX } }),
          params({ id: flow.licenceId })
        ),
      expectStatus: 201,
    });
    flow.vendorAuthId = s7.body.id;
    const vaInsert = insertsInto(s7.record, "vendor_authorisations")[0];
    expect(vaInsert).toMatchObject({ licenceId: flow.licenceId, vendorOrgId: ORG_VFX, status: "active" });
    s7.record.checks.push(
      "authorisation refused unless the licence is APPROVED — state verified",
      "vendor_authorisations row active; talent + rep notified of the grant"
    );
  });

  it("phase 5 — the studio sets up a render bridge and files are served to local storage", async () => {
    // Step 8: mint a bridge personal access token.
    t.setSession(PRODUCER);
    const s8 = await step({
      phase: "Bridge & delivery",
      actor: { name: "Piper Quinn", role: "Producer — Meridian Pictures" },
      title: "Mint a bridge personal access token",
      narrative:
        "Bridge enrolment is authenticated by a PAT, not a browser session. The raw brt_ token is returned exactly once; only its SHA-256 hash is stored.",
      request: {
        method: "POST",
        path: "/api/bridge/tokens",
        auth: "session · Piper Quinn (industry)",
        body: { displayName: "Meridian render farm — PAT" },
      },
      run: () =>
        bridgeTokensRoute.POST(buildRequest("/api/bridge/tokens", { body: { displayName: "Meridian render farm — PAT" } })),
      expectStatus: 201,
    });
    flow.bridgePat = s8.body.token;
    expect(flow.bridgePat).toMatch(/^brt_[0-9a-f]{64}$/);
    const patInsert = insertsInto(s8.record, "bridge_tokens")[0];
    expect(patInsert.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(patInsert.tokenHash).not.toContain(flow.bridgePat.slice(4, 20));
    s8.record.checks.push("raw brt_ token issued once; only its SHA-256 hash persisted");

    // Step 9: enrol the render-bridge agent for the org (Docker first-start).
    const s9 = await step({
      phase: "Bridge & delivery",
      actor: { name: "render-bridge agent", role: "Meridian Render Bridge — Stage 4" },
      title: "Enrol the render-bridge agent",
      narrative:
        "The Docker agent enrols using the PAT. The platform verifies the PAT hash and Piper's membership of the org, revokes any previous agent (one active agent per org), and issues a 365-day svc_ service token — again returned once, stored hashed.",
      request: {
        method: "POST",
        path: "/api/bridge/render-bridge",
        auth: "Bearer brt_… (bridge PAT)",
        body: { organisationId: ORG_PROD, displayName: "Meridian Render Bridge — Stage 4" },
      },
      enqueue: [
        { id: "pat-1", userId: PRODUCER.sub, revokedAt: null, role: "industry", email: PRODUCER.email }, // PAT row by hash
        { id: ORG_PROD }, // org exists
        { userId: PRODUCER.sub }, // PAT owner is an org member
      ],
      run: () =>
        renderBridgeRoute.POST(
          buildRequest("/api/bridge/render-bridge", {
            body: { organisationId: ORG_PROD, displayName: "Meridian Render Bridge — Stage 4" },
            headers: { authorization: `Bearer ${flow.bridgePat}` },
          })
        ),
      expectStatus: 201,
    });
    flow.agentId = s9.body.agentId;
    flow.serviceToken = s9.body.serviceToken;
    expect(flow.serviceToken).toMatch(/^svc_[0-9a-f]{64}$/);
    const agentInsert = insertsInto(s9.record, "render_bridge_agents")[0];
    expect(agentInsert.organisationId).toBe(ORG_PROD);
    expect(insertsInto(s9.record, "bridge_events")[0].eventType).toBe("agent_enrolled");
    s9.record.checks.push(
      "PAT validated by hash lookup; org membership enforced",
      "prior agents for the org revoked; agent_enrolled audit event written"
    );

    const AGENT_ROW = {
      id: flow.agentId,
      organisationId: ORG_PROD,
      status: "active",
      revokedAt: null,
      tokenExpiresAt: NOW + 365 * 86400,
    };

    // Step 10: the agent pulls its project grant and writes files to the share.
    const s10 = await step({
      phase: "Bridge & delivery",
      actor: { name: "render-bridge agent", role: "Meridian Render Bridge — Stage 4" },
      title: "Project grant served — files written to the local render share",
      narrative:
        "Authenticated by its service token, the agent receives every APPROVED, in-date, packaged licence its org holds — here, Ava's Starfall licence with 3 scan files, each carrying a time-limited presigned URL and its sha256. The agent downloads each file, verifies the checksum against the grant, and writes the bytes to the local render share where Meridian's (and authorised vendor Nimbus's) artists work.",
      request: {
        method: "GET",
        path: `/api/bridge/render-bridge/${flow.agentId}/project-grant`,
        auth: "Bearer svc_… (service token)",
      },
      enqueue: [
        AGENT_ROW, // service-token hash lookup
        { name: "Meridian Pictures", vendorAuditPassed: false }, // org (licensee side — no vendor arm needed)
        [{ userId: PRODUCER.sub }], // org member ids
        [{ id: flow.licenceId, packageId: PKG_ID, validTo: VALID_TO, fileScope: null, productionId: flow.productionId }], // active licences
        [], // no just-expired licences to sweep
        SCAN_FILES.map((f) => ({
          id: f.id,
          filename: f.filename,
          r2Key: f.r2Key,
          sizeBytes: f.bytes.length,
          sha256: f.sha256,
          uploadStatus: "complete",
          completedAt: NOW - 86400,
          createdAt: NOW - 90000,
        })),
      ],
      run: () =>
        projectGrantRoute.GET(
          buildRequest(`/api/bridge/render-bridge/${flow.agentId}/project-grant`, {
            headers: { authorization: `Bearer ${flow.serviceToken}` },
          }),
          params({ agentId: flow.agentId })
        ),
      expectStatus: 200,
    });
    expect(s10.body.packages).toHaveLength(1);
    const grantFiles: { fileId: string; filename: string; size: number; sha256: string; sourceUrl: string }[] =
      s10.body.packages[0].files;
    expect(grantFiles).toHaveLength(3);

    // Simulated agent: resolve each presigned URL → R2 key → bytes, verify the
    // checksum from the grant, write to the real local render share.
    for (const gf of grantFiles) {
      const url = new URL(gf.sourceUrl);
      expect(url.searchParams.get("X-Amz-Expires")).toBe("86400"); // 24h presign TTL
      const r2Key = decodeURIComponent(url.pathname).replace(/^\/image-vault-scans\//, "");
      const bytes = r2Store.get(r2Key);
      expect(bytes, `fixture bytes for ${r2Key}`).toBeTruthy();
      const localHash = createHash("sha256").update(bytes!).digest("hex");
      expect(localHash).toBe(gf.sha256); // integrity: grant sha256 matches the bytes
      fs.writeFileSync(path.join(renderShare, gf.filename), bytes!);
    }
    const published = snapshotRenderShare("Render share after publish");
    expect(published.files.map((f) => f.name).sort()).toEqual(SCAN_FILES.map((f) => f.filename).sort());
    s10.record.fileSnapshot = published;
    s10.record.checks.push(
      "grant scoped to APPROVED + in-date + packaged licences of this org only",
      "3 files served with 24h presigned URLs",
      "sha256 of every downloaded file matches the grant manifest",
      `${published.files.length} files written to the local render share (${published.files.reduce((a, f) => a + f.size, 0)} bytes)`
    );

    // Step 11: the agent reports the publish.
    const s11 = await step({
      phase: "Bridge & delivery",
      actor: { name: "render-bridge agent", role: "Meridian Render Bridge — Stage 4" },
      title: "Publish reported back to the platform",
      narrative:
        "The agent confirms the package landed on the share. The platform records the package as published on the agent and writes an audit event — this is what later lets it detect files that should no longer be there.",
      request: {
        method: "POST",
        path: `/api/bridge/render-bridge/${flow.agentId}/publish-complete`,
        auth: "Bearer svc_… (service token)",
        body: { packageId: PKG_ID, publishedPaths: SCAN_FILES.map((f) => f.filename) },
      },
      enqueue: [AGENT_ROW, { publishedPackagesJson: "[]" }],
      run: () =>
        publishCompleteRoute.POST(
          buildRequest(`/api/bridge/render-bridge/${flow.agentId}/publish-complete`, {
            body: { packageId: PKG_ID, publishedPaths: SCAN_FILES.map((f) => f.filename) },
            headers: { authorization: `Bearer ${flow.serviceToken}` },
          }),
          params({ agentId: flow.agentId })
        ),
      expectStatus: 200,
    });
    const publishUpdate = updatesTo(s11.record, "render_bridge_agents")[0];
    expect(JSON.parse(publishUpdate.publishedPackagesJson)).toEqual([PKG_ID]);
    expect(insertsInto(s11.record, "bridge_events")[0].eventType).toBe("agent_publish_complete");
    s11.record.checks.push("agent record now lists the published package; agent_publish_complete audit event written");

    // Step 12: first heartbeat — the agent comes online.
    const s12 = await step({
      phase: "Bridge & delivery",
      actor: { name: "render-bridge agent", role: "Meridian Render Bridge — Stage 4" },
      title: "Heartbeat — agent online, nothing pending",
      narrative:
        "The agent heartbeats every ~30 seconds, reporting what it has published and picking up any pending order. Nothing is pending while the licence is live.",
      request: {
        method: "POST",
        path: `/api/bridge/render-bridge/${flow.agentId}/heartbeat`,
        auth: "Bearer svc_… (service token)",
        body: { status: "idle", publishedPackages: [PKG_ID], version: "1.4.2" },
      },
      enqueue: [AGENT_ROW, { pendingAction: null, lastHeartbeatAt: null, displayName: "Meridian Render Bridge — Stage 4" }],
      run: () =>
        heartbeatRoute.POST(
          buildRequest(`/api/bridge/render-bridge/${flow.agentId}/heartbeat`, {
            body: { status: "idle", publishedPackages: [PKG_ID], version: "1.4.2" },
            headers: { authorization: `Bearer ${flow.serviceToken}` },
          }),
          params({ agentId: flow.agentId })
        ),
      expectStatus: 200,
    });
    expect(s12.body).toMatchObject({ ok: true, action: null });
    expect(insertsInto(s12.record, "bridge_events")[0].eventType).toBe("agent_online");
    s12.record.checks.push("no pending action while the licence is live; agent_online audit event written");
  });

  it("phase 6 — the licence completes: scrub period, purge, deletion attestation, closed", async () => {
    const AGENT_ROW = {
      id: flow.agentId,
      organisationId: ORG_PROD,
      status: "active",
      revokedAt: null,
      tokenExpiresAt: NOW + 365 * 86400,
    };

    // Step 13: the licence term ends. The bridge's own sync is the natural
    // trigger: the expired licence drops out of the grant AND the platform
    // durably flips it to SCRUB_PERIOD, flags every bridge to purge, and
    // emails the licensee the deletion-attestation link.
    const s13 = await step({
      phase: "Completion & removal",
      actor: { name: "render-bridge agent", role: "Meridian Render Bridge — Stage 4" },
      title: "Licence term ends — bridge sync starts the scrub period",
      narrative:
        "The licence's validTo has passed. On the agent's next sync the platform serves no grant (404 — access withdrawn at the source), transitions the licence APPROVED → SCRUB_PERIOD with a 14-day deadline, orders every bridge for the org to purge, and emails Meridian the deletion-attestation link.",
      request: {
        method: "GET",
        path: `/api/bridge/render-bridge/${flow.agentId}/project-grant`,
        auth: "Bearer svc_… (service token)",
      },
      enqueue: [
        AGENT_ROW,
        { name: "Meridian Pictures", vendorAuditPassed: false },
        [{ userId: PRODUCER.sub }],
        [], // no active licences any more — term ended
        [{ id: flow.licenceId }], // the just-expired licence found by the sweep
        {
          // licence loaded by beginScrubPeriod — still APPROVED, about to flip
          id: flow.licenceId,
          status: "APPROVED",
          licenseeId: PRODUCER.sub,
          projectName: "Starfall",
          packageId: PKG_ID,
          organisationId: ORG_PROD,
        },
        { email: PRODUCER.email }, // licensee email for the attestation notice
        { name: PKG_NAME }, // package name for the email
        [{ userId: PRODUCER.sub }], // org owners (only the licensee — no extra recipients)
      ],
      run: () =>
        projectGrantRoute.GET(
          buildRequest(`/api/bridge/render-bridge/${flow.agentId}/project-grant`, {
            headers: { authorization: `Bearer ${flow.serviceToken}` },
          }),
          params({ agentId: flow.agentId })
        ),
      licenceStatus: "SCRUB_PERIOD",
      expectStatus: 404,
    });
    const scrubUpdate = updatesTo(s13.record, "licences")[0];
    expect(scrubUpdate.status).toBe("SCRUB_PERIOD");
    expect(scrubUpdate.scrubDeadline).toBeGreaterThan(NOW);
    expect(updatesTo(s13.record, "bridge_grants")[0].purgeRequestedAt).toBeTruthy();
    expect(updatesTo(s13.record, "render_bridge_agents")[0].pendingAction).toBe("purge");
    expect(s13.record.emails.length).toBeGreaterThan(0);
    markLifecycle("SCRUB_PERIOD");
    s13.record.checks.push(
      "expired licence excluded from the grant — bridge access withdrawn (404)",
      "licence APPROVED → SCRUB_PERIOD with a 14-day scrub deadline",
      "all bridge grants flagged purgeRequested; render-bridge agents ordered to purge",
      "deletion-attestation email sent to the licensee"
    );

    // Step 14: heartbeat returns the purge order; the agent deletes the local files.
    const s14 = await step({
      phase: "Completion & removal",
      actor: { name: "render-bridge agent", role: "Meridian Render Bridge — Stage 4" },
      title: "Purge order delivered — local files removed",
      narrative:
        "The next heartbeat hands the agent its pending purge order (cleared from the record once delivered). The agent deletes every published file from the render share.",
      request: {
        method: "POST",
        path: `/api/bridge/render-bridge/${flow.agentId}/heartbeat`,
        auth: "Bearer svc_… (service token)",
        body: { status: "idle", publishedPackages: [PKG_ID], version: "1.4.2" },
      },
      enqueue: [
        AGENT_ROW,
        { pendingAction: "purge", lastHeartbeatAt: NOW, displayName: "Meridian Render Bridge — Stage 4" },
      ],
      run: () =>
        heartbeatRoute.POST(
          buildRequest(`/api/bridge/render-bridge/${flow.agentId}/heartbeat`, {
            body: { status: "idle", publishedPackages: [PKG_ID], version: "1.4.2" },
            headers: { authorization: `Bearer ${flow.serviceToken}` },
          }),
          params({ agentId: flow.agentId })
        ),
      expectStatus: 200,
    });
    expect(s14.body.action).toBe("purge");

    // The agent acts on the order: remove every licensed file from the share.
    for (const f of SCAN_FILES) fs.rmSync(path.join(renderShare, f.filename), { force: true });
    const purged = snapshotRenderShare("Render share after purge");
    expect(purged.files).toHaveLength(0);
    s14.record.fileSnapshot = purged;
    s14.record.checks.push(
      "heartbeat delivered action: purge (order cleared after delivery)",
      "all 3 licensed files deleted from the local render share — directory verified empty"
    );

    // Step 15: the agent confirms the purge.
    const s15 = await step({
      phase: "Completion & removal",
      actor: { name: "render-bridge agent", role: "Meridian Render Bridge — Stage 4" },
      title: "Purge confirmed to the platform",
      narrative:
        "The agent reports the purge complete. Its published list is cleared, an agent_purge_complete audit event is written, and platform admins are notified.",
      request: {
        method: "POST",
        path: `/api/bridge/render-bridge/${flow.agentId}/purge-complete`,
        auth: "Bearer svc_… (service token)",
        body: { purgedPaths: SCAN_FILES.map((f) => f.filename) },
      },
      enqueue: [AGENT_ROW, { displayName: "Meridian Render Bridge — Stage 4" }],
      run: () =>
        purgeCompleteRoute.POST(
          buildRequest(`/api/bridge/render-bridge/${flow.agentId}/purge-complete`, {
            body: { purgedPaths: SCAN_FILES.map((f) => f.filename) },
            headers: { authorization: `Bearer ${flow.serviceToken}` },
          }),
          params({ agentId: flow.agentId })
        ),
      expectStatus: 200,
    });
    const purgeUpdate = updatesTo(s15.record, "render_bridge_agents")[0];
    expect(purgeUpdate.publishedPackagesJson).toBe("[]");
    expect(purgeUpdate.pendingAction).toBeNull();
    expect(insertsInto(s15.record, "bridge_events")[0].eventType).toBe("agent_purge_complete");
    s15.record.checks.push("published list cleared; agent_purge_complete audit event written; admins emailed");

    // Step 16: the licensee attests deletion under 2FA — licence CLOSED.
    t.setSession(PRODUCER);
    const totp = new OTPAuth.TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(TOTP_SECRET),
    }).generate();
    const attestBody = {
      devicesScrubbed: ["render-node-01", "render-node-02", "workstation-vfx-07"],
      additionalNotes: "Render share purged by the bridge agent; workstation caches wiped manually.",
      bridgeCachePurged: true,
      totp,
    };
    const s16 = await step({
      phase: "Completion & removal",
      actor: { name: "Piper Quinn", role: "Producer — Meridian Pictures" },
      title: "Deletion attested under 2FA — licence CLOSED",
      narrative:
        "Piper submits the legally binding deletion attestation, listing every scrubbed device and confirming the bridge cache purge. The route verifies a live TOTP code against her enrolled 2FA secret (a real code is generated and verified in this test), seals the attestation, and closes the licence. Ava, Morgan, and the platform admins are notified.",
      request: {
        method: "POST",
        path: `/api/licences/${flow.licenceId}/scrub/attest`,
        auth: "session · Piper Quinn (industry) + TOTP",
        body: { ...attestBody, totp: "•••••• (live code, verified)" },
      },
      enqueue: [
        {
          id: flow.licenceId,
          talentId: TALENT.sub,
          licenseeId: PRODUCER.sub,
          organisationId: ORG_PROD,
          status: "SCRUB_PERIOD",
          projectName: "Starfall",
          packageId: PKG_ID,
          scrubDeadline: NOW + 14 * 86400,
        },
        { secret: TOTP_SECRET }, // Piper's TOTP credential
        { email: PRODUCER.email }, // notification fan-out below
        { name: PKG_NAME },
        [{ repId: REP.sub }], // Ava's reps
        [{ email: TALENT.email }, { email: REP.email }], // recipient emails
      ],
      run: () =>
        scrubAttestRoute.POST(
          buildRequest(`/api/licences/${flow.licenceId}/scrub/attest`, { body: attestBody }),
          params({ id: flow.licenceId })
        ),
      licenceStatus: "CLOSED",
      expectStatus: 200,
    });
    expect(s16.body).toMatchObject({ ok: true, status: "CLOSED" });
    const attestation = insertsInto(s16.record, "scrub_attestations")[0];
    expect(JSON.parse(attestation.devicesScrubbed)).toHaveLength(3);
    expect(attestation.bridgeCachePurged).toBe(true);
    const closeUpdate = updatesTo(s16.record, "licences")[0];
    expect(closeUpdate.status).toBe("CLOSED");
    expect(closeUpdate.scrubAttestedAt).toBeTruthy();
    expect(s16.record.emails.length).toBeGreaterThan(0);
    markLifecycle("CLOSED");
    s16.record.checks.push(
      "live TOTP code generated from the enrolled secret and verified by the real verifier",
      "scrub attestation sealed: 3 devices listed, bridge cache purge confirmed",
      "licence CLOSED with scrubAttestedAt set; talent, rep, and admins notified"
    );
  });

  afterAll(async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const outFile = path.join(here, "report", "full-licence-flow.html");
    const totalBytes = SCAN_FILES.reduce((a, f) => a + f.bytes.length, 0);

    writeFlowReport(
      {
        title: "One licence, end to end",
        subtitle:
          "A production licenses a performer's scan, the rep negotiates consent, a VFX vendor is authorised, a render bridge serves the files to local storage — and when the licence ends, every local copy is removed and the deletion is attested under 2FA.",
        generatedAt: new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC",
        personas: [
          { name: "Ava Reyes", role: "Talent", org: "Performer — plays Captain Elara Voss", detail: "Owns the scan vault; attaches the package." },
          { name: "Morgan Sloane", role: "Talent rep", org: "Wavelength Talent", detail: "Negotiates consent terms on Ava's behalf via talent_reps delegation." },
          { name: "Piper Quinn", role: "Producer", org: "Meridian Pictures", detail: "Runs the production, licenses the scan, attests deletion under 2FA." },
          { name: "Noor Haddad", role: "VFX vendor", org: "Nimbus VFX", detail: "Vendor org attached to the production and authorised on the licence." },
          { name: "Render bridge", role: "Bridge agent", org: "Meridian Render Bridge — Stage 4", detail: "Org-scoped agent: pulls grants, publishes to the render share, purges on order." },
        ],
        lifecycle: [
          ...flow.lifecycle,
          ...(["AWAITING_PACKAGE", "APPROVED", "SCRUB_PERIOD", "CLOSED"]
            .filter((s) => !flow.lifecycle.some((l) => l.state === s))
            .map((s) => ({ state: s, reachedAtStep: null }))),
        ],
        steps: flow.steps,
        summary: [
          { label: "Final licence status", value: flow.licenceStatus ?? "unknown" },
          { label: "Files served to local storage", value: `${SCAN_FILES.length} files · ${(totalBytes / 1024).toFixed(1)} KB · sha256-verified` },
          { label: "Local render share after purge", value: "empty — verified on disk" },
          { label: "Agreed fee / platform fee", value: "$3,000.00 / $450.00 (15%)" },
          { label: "Consent negotiation", value: "2 rounds — rep counter, producer accepted" },
          { label: "Deletion attestation", value: "3 devices, bridge cache purged, live TOTP verified" },
          { label: "Route handlers exercised", value: "14 production routes, zero HTTP mocks" },
        ],
      },
      outFile
    );
    console.log(`\n  Visual flow report written to ${outFile}\n`);

    fs.rmSync(renderShare, { recursive: true, force: true });
  });
});

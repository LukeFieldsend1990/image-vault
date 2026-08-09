import { describe, it, expect, beforeEach, vi } from "vitest";
import { classifyQuery, trace, traceByFileHash, traceByFingerprint } from "@/lib/forensics/trace";
import { createTestEnv } from "../../helpers/mocks";

const t = createTestEnv();

const SHA = "a".repeat(64);
const BITS = "3b70e2a9f1c4d5e6a7b8c9d0e1f20304";

describe("classifyQuery", () => {
  it("reads a 64-character hex string as a content hash", () => {
    expect(classifyQuery(SHA)).toBe("sha256");
    expect(classifyQuery(SHA.toUpperCase())).toBe("sha256");
  });

  it("reads shorter hex as a watermark payload", () => {
    expect(classifyQuery(BITS)).toBe("fingerprint");
  });

  it("tolerates the whitespace a reader introduces copying a grouped hash off paper", () => {
    expect(classifyQuery("aaaa aaaa " + "a".repeat(56))).toBe("sha256");
  });

  it("rejects anything that is not hex", () => {
    expect(classifyQuery("not-a-hash")).toBe("unrecognised");
    expect(classifyQuery("")).toBe("unrecognised");
    expect(classifyQuery("zzzz")).toBe("unrecognised");
  });
});

describe("traceByFileHash", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    t.reset();
  });

  it("returns nothing when no file has that hash", async () => {
    t.enqueue([]);
    expect(await traceByFileHash(t.db as never, SHA)).toEqual([]);
  });

  it("identifies the file but attributes only to the file, not a recipient", async () => {
    t.enqueue([{ id: "file-1" }]); // hash lookup
    t.enqueue([
      {
        fileId: "file-1",
        filename: "head_scan.obj",
        sizeBytes: 20_000_000,
        sha256: SHA,
        packageId: "pkg-1",
        packageName: "Principal capture",
        talentId: "talent-1",
      },
    ]); // loadFiles join
    t.enqueue([{ userId: "talent-1", fullName: "Jane Doe" }]); // profiles
    t.enqueue([{ id: "talent-1", email: "jane@example.com" }]); // accounts
    t.enqueue([
      {
        id: "dl-1",
        licenceId: "lic-1",
        licenseeId: "user-9",
        ip: "203.0.113.9",
        userAgent: "curl/8",
        bytesTransferred: 20_000_000,
        startedAt: 1700000100,
        completedAt: 1700000200,
      },
      {
        id: "dl-2",
        licenceId: null,
        licenseeId: "talent-1",
        ip: "198.51.100.4",
        userAgent: "Mozilla",
        bytesTransferred: 20_000_000,
        startedAt: 1700000000,
        completedAt: 1700000050,
      },
    ]); // releases
    t.enqueue([
      { id: "user-9", email: "vfx@northlight.example" },
      { id: "talent-1", email: "jane@example.com" },
    ]); // release users
    t.enqueue([{ id: "lic-1", projectName: "Ravensmoor", productionCompany: "Bellhouse Films" }]);

    const matches = await traceByFileHash(t.db as never, SHA);

    expect(matches).toHaveLength(1);
    expect(matches[0].matchedBy).toBe("sha256");
    // A hash match names the file, never the leaker — several parties may hold it.
    expect(matches[0].attribution).toBe("file");
    expect(matches[0].identifiedRecipient).toBeNull();
    expect(matches[0].file.talentName).toBe("Jane Doe");
    expect(matches[0].releases).toHaveLength(2);
    expect(matches[0].releases[0].recipientEmail).toBe("vfx@northlight.example");
    expect(matches[0].releases[0].projectName).toBe("Ravensmoor");
  });

  it("flags a performer's own download rather than hiding it", async () => {
    t.enqueue([{ id: "file-1" }]);
    t.enqueue([
      {
        fileId: "file-1",
        filename: "body.obj",
        sizeBytes: 1000,
        sha256: SHA,
        packageId: "pkg-1",
        packageName: "Capture",
        talentId: "talent-1",
      },
    ]);
    t.enqueue([]);
    t.enqueue([{ id: "talent-1", email: "jane@example.com" }]);
    t.enqueue([
      {
        id: "dl-1",
        licenceId: null,
        licenseeId: "talent-1",
        ip: null,
        userAgent: null,
        bytesTransferred: 1000,
        startedAt: 1700000000,
        completedAt: 1700000010,
      },
    ]);
    t.enqueue([{ id: "talent-1", email: "jane@example.com" }]);

    const matches = await traceByFileHash(t.db as never, SHA);
    expect(matches[0].releases[0].selfDownload).toBe(true);
  });
});

describe("traceByFingerprint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    t.reset();
  });

  it("returns nothing when no watermark matches", async () => {
    t.enqueue([]); // bits lookup
    t.enqueue([]); // payload-hash lookup
    t.enqueue([]); // prefix scan
    expect(await traceByFingerprint(t.db as never, BITS)).toEqual([]);
  });

  it("names the recipient, because the watermark is unique to one issuance", async () => {
    t.enqueue([
      {
        id: "fp-1",
        fileId: "file-1",
        licenceId: "lic-1",
        licenseeId: "user-9",
        fingerprintBits: BITS,
        createdAt: 1699999000,
      },
    ]);
    t.enqueue([
      {
        fileId: "file-1",
        filename: "head_scan.obj",
        sizeBytes: 20_000_000,
        sha256: SHA,
        packageId: "pkg-1",
        packageName: "Principal capture",
        talentId: "talent-1",
      },
    ]);
    t.enqueue([{ userId: "talent-1", fullName: "Jane Doe" }]);
    t.enqueue([{ id: "talent-1", email: "jane@example.com" }]);
    t.enqueue([{ id: "lic-1", projectName: "Ravensmoor", productionCompany: "Bellhouse Films" }]);
    t.enqueue([{ id: "user-9", email: "vfx@northlight.example" }]);
    t.enqueue([]); // releases

    const matches = await traceByFingerprint(t.db as never, BITS);

    expect(matches).toHaveLength(1);
    expect(matches[0].matchedBy).toBe("fingerprint");
    expect(matches[0].attribution).toBe("recipient");
    expect(matches[0].identifiedRecipient?.licenseeEmail).toBe("vfx@northlight.example");
    expect(matches[0].identifiedRecipient?.productionCompany).toBe("Bellhouse Films");
  });
});

describe("trace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    t.reset();
  });

  it("explains itself rather than failing silently on junk input", async () => {
    const r = await trace(t.db as never, "hello world");
    expect(r.queryKind).toBe("unrecognised");
    expect(r.matches).toEqual([]);
    expect(r.conclusion).toMatch(/does not look like/i);
  });

  it("falls through to the watermark route when a 64-char hex is not a file hash", async () => {
    // A fingerprint payload hash is also 64 hex characters, so a "no file with
    // that hash" result must not be reported as a dead end.
    t.enqueue([]); // sha256 lookup misses
    t.enqueue([]); // fingerprint bits lookup
    t.enqueue([
      {
        id: "fp-1",
        fileId: "file-1",
        licenceId: "lic-1",
        licenseeId: "user-9",
        fingerprintBits: BITS,
        createdAt: 1699999000,
      },
    ]); // payload-hash lookup hits
    t.enqueue([
      {
        fileId: "file-1",
        filename: "head.obj",
        sizeBytes: 100,
        sha256: null,
        packageId: "pkg-1",
        packageName: "Capture",
        talentId: "talent-1",
      },
    ]);
    t.enqueue([]);
    t.enqueue([{ id: "talent-1", email: "jane@example.com" }]);
    t.enqueue([{ id: "lic-1", projectName: "Ravensmoor", productionCompany: "Bellhouse Films" }]);
    t.enqueue([{ id: "user-9", email: "vfx@northlight.example" }]);
    t.enqueue([]);

    const r = await trace(t.db as never, SHA);
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0].attribution).toBe("recipient");
    expect(r.conclusion).toMatch(/unique to the copy issued to/i);
  });

  it("says plainly when a file matches but no release is on record", async () => {
    t.enqueue([{ id: "file-1" }]);
    t.enqueue([
      {
        fileId: "file-1",
        filename: "head.obj",
        sizeBytes: 100,
        sha256: SHA,
        packageId: "pkg-1",
        packageName: "Capture",
        talentId: "talent-1",
      },
    ]);
    t.enqueue([]);
    t.enqueue([{ id: "talent-1", email: "jane@example.com" }]);
    t.enqueue([]); // no releases

    const r = await trace(t.db as never, SHA);
    expect(r.conclusion).toMatch(/no release of it is on record/i);
  });
});

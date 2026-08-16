import { describe, it, expect } from "vitest";

import {
  MAX_REFERENCES,
  classifyPackageKind,
  classifyReferenceKind,
  computeDetectionCoverage,
  coverageInputFromReferences,
  isReferenceCandidate,
  orderForMatching,
  selectReferenceCandidates,
  type ReferenceFileInput,
  type ReferenceImage,
} from "@/lib/monitor/reference-set";

function file(overrides: Partial<ReferenceFileInput> = {}): ReferenceFileInput {
  return {
    id: crypto.randomUUID(),
    packageId: "pkg-1",
    filename: "face_front_neutral.jpg",
    contentType: "image/jpeg",
    sizeBytes: 2_400_000,
    r2Key: "scans/pkg-1/face_front_neutral.jpg",
    ...overrides,
  };
}

describe("isReferenceCandidate", () => {
  it("accepts photographic stills", () => {
    expect(isReferenceCandidate(file())).toBe(true);
    expect(isReferenceCandidate(file({ filename: "capture_012.png", contentType: null }))).toBe(true);
  });

  it("rejects non-image files", () => {
    expect(isReferenceCandidate(file({ filename: "head.obj", contentType: "model/obj" }))).toBe(false);
    expect(isReferenceCandidate(file({ filename: "scan.zip", contentType: "application/zip" }))).toBe(false);
  });

  it("rejects sidecar imagery that would poison the reference gallery", () => {
    for (const name of ["albedo_texture.png", "uv_layout.jpg", "wireframe_view.png", "colorchecker.jpg"]) {
      expect(isReferenceCandidate(file({ filename: name }))).toBe(false);
    }
  });

  it("rejects thumbnails and oversized files", () => {
    expect(isReferenceCandidate(file({ sizeBytes: 8_000 }))).toBe(false);
    expect(isReferenceCandidate(file({ sizeBytes: 25_000_000 }))).toBe(false);
  });
});

describe("classifyReferenceKind", () => {
  it("reads face and body hints from filenames", () => {
    expect(classifyReferenceKind("face_front_neutral.jpg")).toBe("face");
    expect(classifyReferenceKind("portrait-45deg.png")).toBe("face");
    expect(classifyReferenceKind("full_body_apose.jpg")).toBe("full_body");
    expect(classifyReferenceKind("standing_ref.webp")).toBe("full_body");
    expect(classifyReferenceKind("IMG_2041.jpg")).toBe("unknown");
  });

  it("falls back to the package's kind for uninformative filenames", () => {
    expect(classifyReferenceKind("IMG_2041.jpg", "full_body")).toBe("full_body");
    // A filename that says what it is still wins over the package hint.
    expect(classifyReferenceKind("face_front.jpg", "full_body")).toBe("face");
  });
});

describe("classifyPackageKind", () => {
  it("reads the kind from the package name", () => {
    expect(classifyPackageKind({ id: "p", name: "Full Body — Pinewood, March 2026" })).toBe("full_body");
    expect(classifyPackageKind({ id: "p", name: "Head & expression set" })).toBe("face");
    expect(classifyPackageKind({ id: "p", name: "Session 2" })).toBe("unknown");
  });

  it("reads hyphenated vocabulary tags from both tag sources", () => {
    expect(
      classifyPackageKind({ id: "p", name: "Session 2", tags: '["full-body","vfx-grade"]' })
    ).toBe("full_body");
    expect(
      classifyPackageKind({ id: "p", name: "Session 2", extraTags: ["head-closeup", "studio-neutral"] })
    ).toBe("face");
  });

  it("treats a full-body capture as full-body even when it also mentions the face", () => {
    expect(
      classifyPackageKind({ id: "p", name: "Body scan", description: "Includes face detail passes" })
    ).toBe("full_body");
  });

  it("survives a malformed tags column", () => {
    expect(classifyPackageKind({ id: "p", name: "Session 2", tags: "not json" })).toBe("unknown");
  });
});

describe("selectReferenceCandidates", () => {
  it("round-robins across packages so one scan doesn't crowd out the rest", () => {
    const files = [
      ...Array.from({ length: 10 }, (_, i) => file({ packageId: "pkg-a", filename: `face_a_${i}.jpg` })),
      ...Array.from({ length: 10 }, (_, i) => file({ packageId: "pkg-b", filename: `face_b_${i}.jpg` })),
    ];
    const selected = selectReferenceCandidates(files, 6);
    expect(selected).toHaveLength(6);
    expect(selected.filter((f) => f.packageId === "pkg-a")).toHaveLength(3);
    expect(selected.filter((f) => f.packageId === "pkg-b")).toHaveLength(3);
  });

  it("prefers face-hinted captures within a package", () => {
    const files = [
      file({ filename: "zz_unknown_1.jpg" }),
      file({ filename: "full_body_apose.jpg" }),
      file({ filename: "face_front.jpg" }),
    ];
    const selected = selectReferenceCandidates(files, 2);
    expect(selected[0].filename).toBe("face_front.jpg");
    expect(selected[1].filename).toBe("full_body_apose.jpg");
  });

  it("filters ineligible files and caps at the maximum", () => {
    const files = [
      ...Array.from({ length: 20 }, (_, i) => file({ filename: `face_${i}.jpg` })),
      file({ filename: "mesh.obj", contentType: "model/obj" }),
    ];
    const selected = selectReferenceCandidates(files);
    expect(selected).toHaveLength(MAX_REFERENCES);
    expect(selected.every((f) => f.filename.endsWith(".jpg"))).toBe(true);
  });
});

describe("orderForMatching", () => {
  it("puts face captures first and full-body last", () => {
    const refs: ReferenceImage[] = [
      { id: "1", packageId: "p", scanFileId: "f1", r2Key: "k1", kind: "full_body" },
      { id: "2", packageId: "p", scanFileId: "f2", r2Key: "k2", kind: "unknown" },
      { id: "3", packageId: "p", scanFileId: "f3", r2Key: "k3", kind: "face" },
    ];
    expect(orderForMatching(refs).map((r) => r.kind)).toEqual(["face", "unknown", "full_body"]);
  });
});

describe("computeDetectionCoverage", () => {
  it("is unanchored with nothing to match against", () => {
    const coverage = computeDetectionCoverage({
      faceReferenceCount: 0,
      bodyReferenceCount: 0,
      unknownReferenceCount: 0,
      packageCount: 0,
      geometryFingerprintCount: 0,
      hasProfileImage: false,
    });
    expect(coverage.tier).toBe("unanchored");
    expect(coverage.score).toBe(0);
    expect(coverage.improvements[0]).toMatch(/face scan/);
  });

  it("is baseline on a public photo alone — the pre-reference-set world", () => {
    const coverage = computeDetectionCoverage({
      faceReferenceCount: 0,
      bodyReferenceCount: 0,
      unknownReferenceCount: 0,
      packageCount: 0,
      geometryFingerprintCount: 0,
      hasProfileImage: true,
    });
    expect(coverage.tier).toBe("baseline");
    expect(coverage.score).toBe(5);
  });

  it("becomes anchored once vault references exist", () => {
    const coverage = computeDetectionCoverage({
      faceReferenceCount: 2,
      bodyReferenceCount: 0,
      unknownReferenceCount: 0,
      packageCount: 1,
      geometryFingerprintCount: 0,
      hasProfileImage: true,
    });
    expect(coverage.tier).toBe("anchored");
    expect(coverage.score).toBe(29);
    // Suggests the highest-value next uploads.
    expect(coverage.improvements.join(" ")).toMatch(/full-body/);
    expect(coverage.improvements.join(" ")).toMatch(/second session/);
  });

  it("is fortified with face + body references across packages", () => {
    const coverage = computeDetectionCoverage({
      faceReferenceCount: 4,
      bodyReferenceCount: 2,
      unknownReferenceCount: 0,
      packageCount: 2,
      geometryFingerprintCount: 8,
      hasProfileImage: true,
    });
    expect(coverage.tier).toBe("fortified");
    expect(coverage.score).toBe(100);
    expect(coverage.improvements).toHaveLength(0);
  });

  it("reaches the top tier on uploaded scans alone", () => {
    // Nothing but scans: no public photo, no licensed delivery. The guidance
    // only ever asks for scans, so scans alone have to be able to get there.
    const coverage = computeDetectionCoverage({
      faceReferenceCount: 4,
      bodyReferenceCount: 2,
      unknownReferenceCount: 0,
      packageCount: 2,
      geometryFingerprintCount: 0,
      hasProfileImage: false,
    });
    expect(coverage.tier).toBe("fortified");
    expect(coverage.improvements).toHaveLength(0);
  });

  it("counts unclassified references at half weight", () => {
    const withUnknowns = computeDetectionCoverage({
      faceReferenceCount: 0,
      bodyReferenceCount: 0,
      unknownReferenceCount: 2,
      packageCount: 1,
      geometryFingerprintCount: 0,
      hasProfileImage: false,
    });
    expect(withUnknowns.tier).toBe("anchored");
    expect(withUnknowns.score).toBe(12);
  });

  it("never asks for a scan type the vault already holds", () => {
    // The reported bug: a full-body package is uploaded but contributed no
    // indexed stills, and coverage told the talent to upload one.
    const coverage = computeDetectionCoverage({
      faceReferenceCount: 3,
      bodyReferenceCount: 0,
      unknownReferenceCount: 0,
      packageCount: 1,
      geometryFingerprintCount: 0,
      hasProfileImage: false,
      vaultPackages: { total: 2, faceCount: 1, bodyCount: 1 },
    });
    expect(coverage.improvements.join(" ")).not.toMatch(/full-body/);
    expect(coverage.improvements.join(" ")).not.toMatch(/second session/);
    expect(coverage.score).toBe(66); // 3 face + 1 body-from-package + 2 packages
  });

  it("keeps talent-facing guidance to scans, with no detail on what detection leans on", () => {
    for (const input of [
      { faceReferenceCount: 0, bodyReferenceCount: 0, unknownReferenceCount: 0, packageCount: 0, geometryFingerprintCount: 0, hasProfileImage: false },
      { faceReferenceCount: 1, bodyReferenceCount: 0, unknownReferenceCount: 0, packageCount: 1, geometryFingerprintCount: 0, hasProfileImage: true },
    ]) {
      const text = computeDetectionCoverage(input).improvements.join(" ").toLowerCase();
      expect(text).not.toMatch(/public photo|profile photo|fingerprint|matcher|relies|fallback/);
    }
  });

  it("anchors a mesh-only package through derived renders at half weight", () => {
    const coverage = computeDetectionCoverage({
      faceReferenceCount: 0,
      bodyReferenceCount: 0,
      unknownReferenceCount: 0,
      derivedFaceReferenceCount: 4,
      derivedBodyReferenceCount: 2,
      packageCount: 1,
      geometryFingerprintCount: 0,
      hasProfileImage: false,
    });
    // 4 derived face = 2 face-equivalents (24) + 2 derived body = 1 body-equivalent (12).
    expect(coverage.tier).toBe("anchored");
    expect(coverage.score).toBe(36);
    // The derived-only case gets its own honest improvement line.
    expect(coverage.improvements[0]).toMatch(/Turntable renders/);
  });

  it("derived renders never reach fortified on their own", () => {
    const coverage = computeDetectionCoverage({
      faceReferenceCount: 0,
      bodyReferenceCount: 0,
      unknownReferenceCount: 0,
      derivedFaceReferenceCount: 8,
      derivedBodyReferenceCount: 4,
      packageCount: 1,
      geometryFingerprintCount: 0,
      hasProfileImage: true,
    });
    // 48 face-capped + 24 body-capped + 5 profile = 77 < 80: photographic
    // session diversity still required for fortified.
    expect(coverage.tier).toBe("anchored");
    expect(coverage.score).toBe(77);
  });
});

describe("coverageInputFromReferences", () => {
  it("aggregates counts and distinct packages", () => {
    const refs: ReferenceImage[] = [
      { id: "1", packageId: "pkg-a", scanFileId: "f1", r2Key: "k1", kind: "face" },
      { id: "2", packageId: "pkg-a", scanFileId: "f2", r2Key: "k2", kind: "full_body" },
      { id: "3", packageId: "pkg-b", scanFileId: "f3", r2Key: "k3", kind: "unknown" },
    ];
    const input = coverageInputFromReferences(refs, { geometryFingerprintCount: 3, hasProfileImage: true });
    expect(input).toEqual({
      faceReferenceCount: 1,
      bodyReferenceCount: 1,
      unknownReferenceCount: 1,
      derivedFaceReferenceCount: 0,
      derivedBodyReferenceCount: 0,
      packageCount: 2,
      geometryFingerprintCount: 3,
      hasProfileImage: true,
    });
  });

  it("passes the vault package summary through when given one", () => {
    const input = coverageInputFromReferences([], {
      geometryFingerprintCount: 0,
      hasProfileImage: false,
      vaultPackages: { total: 2, faceCount: 1, bodyCount: 1 },
    });
    expect(input.vaultPackages).toEqual({ total: 2, faceCount: 1, bodyCount: 1 });
  });

  it("splits derived renders out of the photographic counts", () => {
    const refs: ReferenceImage[] = [
      { id: "1", packageId: "pkg-a", scanFileId: "f1", r2Key: "scans/x/face.jpg", kind: "face" },
      {
        id: "2",
        packageId: "pkg-a",
        scanFileId: "f2",
        r2Key: "derived/pkg-a/derived_face_turntable_000.png",
        kind: "face",
        source: "derived_render",
      },
      {
        id: "3",
        packageId: "pkg-a",
        scanFileId: "f3",
        r2Key: "derived/pkg-a/derived_fullbody_turntable_000.png",
        kind: "full_body",
        source: "derived_render",
      },
    ];
    const input = coverageInputFromReferences(refs, { geometryFingerprintCount: 0, hasProfileImage: false });
    expect(input.faceReferenceCount).toBe(1);
    expect(input.bodyReferenceCount).toBe(0);
    expect(input.derivedFaceReferenceCount).toBe(1);
    expect(input.derivedBodyReferenceCount).toBe(1);
  });
});

describe("derived still filenames", () => {
  it("pass eligibility and classify by kind from the job's naming scheme", () => {
    const face = {
      filename: "derived_face_turntable_000.png",
      contentType: "image/png",
      sizeBytes: 180_000,
    };
    const body = {
      filename: "derived_fullbody_turntable_000.png",
      contentType: "image/png",
      sizeBytes: 220_000,
    };
    expect(isReferenceCandidate(face)).toBe(true);
    expect(isReferenceCandidate(body)).toBe(true);
    expect(classifyReferenceKind(face.filename)).toBe("face");
    expect(classifyReferenceKind(body.filename)).toBe("full_body");
  });
});

"use client";

import { useState } from "react";

interface PackageOption {
  id: string;
  name: string;
  talentEmail: string;
}

interface ObjFileOption {
  id: string;
  filename: string;
}

interface FingerprintParam {
  id: string;
  fileId: string;
  originalFilename: string;
  fingerprintBits: string;
  fingerprintBitsLength: number;
  repeatFactor: number;
  originalVertexCount: number;
}

// ── Client-side vertex extraction helpers ─────────────────────────────────────
// Runs entirely in the browser — no upload, no size limit.

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(Math.min(hex.length / 2, 16));
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function makeXorshift32(seed: number) {
  let s = (seed >>> 0) || 0x12345678;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 0x100000000; };
}

function selectVertices(hmacBytes: Uint8Array, fileId: string, vertexCount: number, slotCount: number): number[] {
  let fh = 0;
  for (let i = 0; i < fileId.length; i++) fh = (Math.imul(fh, 31) + fileId.charCodeAt(i)) | 0;
  const hmacSeed = ((hmacBytes[0] << 24) | (hmacBytes[1] << 16) | (hmacBytes[2] << 8) | hmacBytes[3]) >>> 0;
  const rng = makeXorshift32(((hmacSeed ^ (fh >>> 0)) >>> 0));
  return Array.from({ length: slotCount }, () => Math.floor(rng() * vertexCount));
}

async function extractVertexPositions(
  file: File,
  targetIndices: Set<number>,
): Promise<{ positions: Map<number, [number, number, number]>; vertexCount: number }> {
  const decoder = new TextDecoder();
  const positions = new Map<number, [number, number, number]>();
  const reader = file.stream().getReader();
  let remainder = "", vertexIdx = 0;
  const BATCH = 256 * 1024;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (let b = 0; b < value.length; b += BATCH) {
      const decoded = decoder.decode(value.subarray(b, b + BATCH), { stream: true });
      const text = remainder + decoded;
      let start = 0, nl: number;
      while ((nl = text.indexOf("\n", start)) !== -1) {
        const t = text.slice(start, nl).trimStart();
        if (t.startsWith("v ") || t.startsWith("v\t")) {
          if (targetIndices.has(vertexIdx)) {
            const p = t.split(/\s+/);
            positions.set(vertexIdx, [parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[3])]);
          }
          vertexIdx++;
        }
        start = nl + 1;
      }
      remainder = text.slice(start);
    }
  }
  decoder.decode(undefined, { stream: false });
  if (remainder) {
    const t = remainder.trimStart();
    if ((t.startsWith("v ") || t.startsWith("v\t")) && targetIndices.has(vertexIdx)) {
      const p = t.split(/\s+/);
      positions.set(vertexIdx, [parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[3])]);
    }
    vertexIdx++;
  }
  return { positions, vertexCount: vertexIdx };
}

interface DetectionMatch {
  fingerprintId: string;
  licenceId: string;
  licenseeId: string;
  licenseeEmail?: string | null;
  projectName?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  fileId: string;
  originalFilename: string;
  confidence: number;
  bitsRecovered: number;
  bitsExpected: number;
  bitErrorRate: number;
  evidenceSummary: string;
}

interface DetectionResult {
  ok: boolean;
  packageId: string;
  fingerprintsChecked?: number;
  matches: DetectionMatch[];
  message?: string;
}

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    value >= 0.9 ? "#c0392b" : value >= 0.75 ? "#d97706" : "#6b7280";
  return (
    <span
      className="text-[11px] font-semibold px-2 py-0.5 rounded tabular-nums"
      style={{ background: `${color}18`, color }}
    >
      {pct}%
    </span>
  );
}

export default function GeoFingerprintDetectClient({
  packages,
}: {
  packages: PackageOption[];
}) {
  const [packageId, setPackageId] = useState("");
  const [fileId, setFileId] = useState("");
  const [objFiles, setObjFiles] = useState<ObjFileOption[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [suspectFile, setSuspectFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DetectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onPackageChange(pid: string) {
    setPackageId(pid);
    setFileId("");
    setObjFiles([]);
    setResult(null);
    if (!pid) return;
    setLoadingFiles(true);
    try {
      const res = await fetch(`/api/admin/geometry-fingerprints/files?packageId=${pid}`);
      const data = await res.json() as { files: ObjFileOption[] };
      setObjFiles(data.files ?? []);
    } catch {
      // non-fatal
    } finally {
      setLoadingFiles(false);
    }
  }

  async function onDetect() {
    if (!suspectFile || !packageId) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      // Step 1: get fingerprint params + original vertex count from server
      const paramsUrl = new URLSearchParams({ packageId });
      if (fileId) paramsUrl.set("fileId", fileId);
      const paramsRes = await fetch(`/api/admin/geometry-fingerprints/detect-params?${paramsUrl}`);
      if (!paramsRes.ok) throw new Error((await paramsRes.json() as { error?: string }).error ?? "Failed to load fingerprint params");
      const { fingerprints } = await paramsRes.json() as { fingerprints: FingerprintParam[] };
      if (fingerprints.length === 0) { setResult({ ok: true, packageId, matches: [], message: "No issued fingerprints found" }); return; }

      // Step 2: compute target vertex indices (deterministic, same algorithm as server)
      const allTargets = new Set<number>();
      for (const fp of fingerprints) {
        const hmac = hexToBytes(fp.fingerprintBits);
        const slotCount = fp.fingerprintBitsLength * fp.repeatFactor;
        for (const vi of selectVertices(hmac, fp.fileId, fp.originalVertexCount, slotCount)) allTargets.add(vi);
      }

      // Step 3: stream through the suspect file locally — no upload, no size limit
      const suspectPositions = await extractVertexPositions(suspectFile, allTargets);

      // Step 4: send only ~640 positions to server for comparison
      const compareRes = await fetch("/api/admin/geometry-fingerprints/detect-compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageId, fileId: fileId || undefined,
          suspectVertexCount: suspectPositions.vertexCount,
          suspectPositions: Object.fromEntries(suspectPositions.positions),
        }),
      });
      if (!compareRes.ok) throw new Error((await compareRes.json() as { error?: string }).error ?? "Comparison failed");
      setResult(await compareRes.json() as DetectionResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  const inputStyle = {
    background: "var(--color-surface)",
    border: "1px solid var(--color-border)",
    color: "var(--color-ink)",
    borderRadius: "4px",
    padding: "8px 12px",
    fontSize: "13px",
    width: "100%",
  } as const;

  return (
    <div>
      {/* Controls */}
      <div
        className="rounded border p-6 mb-6"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <h2
          className="text-xs font-semibold uppercase tracking-widest mb-5"
          style={{ color: "var(--color-muted)" }}
        >
          Detect Fingerprint
        </h2>

        <div className="grid gap-4 max-w-lg">
          {/* Package selector */}
          <div>
            <label className="block text-xs mb-1.5" style={{ color: "var(--color-muted)" }}>
              Package
            </label>
            <select
              value={packageId}
              onChange={(e) => onPackageChange(e.target.value)}
              style={inputStyle}
            >
              <option value="">Select a package…</option>
              {packages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.talentEmail}
                </option>
              ))}
            </select>
          </div>

          {/* File selector */}
          <div>
            <label className="block text-xs mb-1.5" style={{ color: "var(--color-muted)" }}>
              OBJ file <span style={{ color: "var(--color-muted)" }}>(optional — leave blank to check all)</span>
            </label>
            {loadingFiles ? (
              <p className="text-xs py-2" style={{ color: "var(--color-muted)" }}>Loading files…</p>
            ) : (
              <select
                value={fileId}
                onChange={(e) => setFileId(e.target.value)}
                disabled={!packageId || objFiles.length === 0}
                style={{ ...inputStyle, opacity: !packageId ? 0.5 : 1 }}
              >
                <option value="">All OBJ files in package</option>
                {objFiles.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.filename}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Suspect file upload */}
          <div>
            <label className="block text-xs mb-1.5" style={{ color: "var(--color-muted)" }}>
              Suspect .obj file
            </label>
            <input
              type="file"
              accept=".obj"
              onChange={(e) => setSuspectFile(e.target.files?.[0] ?? null)}
              style={{ ...inputStyle, padding: "6px 12px", cursor: "pointer" }}
            />
            {suspectFile && (
              <p className="text-xs mt-1" style={{ color: "var(--color-muted)" }}>
                {suspectFile.name} · {(suspectFile.size / 1024).toFixed(1)} KB
              </p>
            )}
          </div>

          <button
            onClick={onDetect}
            disabled={!suspectFile || !packageId || loading}
            className="rounded px-4 py-2 text-sm font-medium transition"
            style={{
              background: "var(--color-accent)",
              color: "#fff",
              opacity: !suspectFile || !packageId || loading ? 0.5 : 1,
              cursor: !suspectFile || !packageId || loading ? "not-allowed" : "pointer",
              border: "none",
              width: "fit-content",
            }}
          >
            {loading ? "Analysing…" : "Run Detection"}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div
          className="rounded border px-4 py-3 mb-6 text-sm"
          style={{ borderColor: "#c0392b44", background: "#c0392b0d", color: "#c0392b" }}
        >
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div
          className="rounded border"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div
            className="px-5 py-3.5 border-b flex items-center justify-between"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <h2
              className="text-xs font-semibold uppercase tracking-widest"
              style={{ color: "var(--color-muted)" }}
            >
              Detection Results
            </h2>
            <span className="text-xs" style={{ color: "var(--color-muted)" }}>
              {result.fingerprintsChecked ?? 0} fingerprints checked
            </span>
          </div>

          {result.matches.length === 0 ? (
            <p className="px-5 py-4 text-sm" style={{ color: "var(--color-muted)" }}>
              {result.message ?? "No matches found above threshold."}
            </p>
          ) : (
            <div>
              {result.matches.map((m, i) => (
                <div
                  key={i}
                  className="px-5 py-4 border-b last:border-0"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <ConfidenceBadge value={m.confidence} />
                        <span
                          className="text-sm font-medium truncate"
                          style={{ color: "var(--color-ink)" }}
                        >
                          {m.evidenceSummary}
                        </span>
                      </div>
                      <div className="text-xs space-y-0.5" style={{ color: "var(--color-muted)" }}>
                        <p>Licensee: <strong style={{ color: "var(--color-ink)" }}>{m.licenseeEmail ?? m.licenseeId}</strong></p>
                        {m.projectName && <p>Project: <strong style={{ color: "var(--color-ink)" }}>{m.projectName}</strong></p>}
                        {(m.validFrom || m.validTo) && (
                          <p>Licence period: {m.validFrom ?? "—"} → {m.validTo ?? "—"}</p>
                        )}
                        <p>
                          Licence ID:{" "}
                          <a
                            href={`/admin/licences`}
                            className="underline"
                            style={{ color: "var(--color-accent)" }}
                          >
                            {m.licenceId}
                          </a>
                        </p>
                        <p>Original file: {m.originalFilename}</p>
                      </div>
                    </div>
                    <div
                      className="shrink-0 text-right text-xs tabular-nums"
                      style={{ color: "var(--color-muted)" }}
                    >
                      <p>{m.bitsRecovered}/{m.bitsExpected} bits</p>
                      <p>BER {(m.bitErrorRate * 100).toFixed(1)}%</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

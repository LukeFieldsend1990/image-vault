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

interface DetectionMatch {
  fingerprintId: string;
  licenceId: string;
  licenseeId: string;
  licenseeEmail?: string;
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
      const fd = new FormData();
      fd.append("file", suspectFile);
      fd.append("packageId", packageId);
      if (fileId) fd.append("fileId", fileId);
      const res = await fetch("/api/admin/geometry-fingerprints/detect", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? "Detection failed");
      }
      const data = await res.json() as DetectionResult;
      setResult(data);
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
                        <p>Licensee: {m.licenseeEmail ?? m.licenseeId}</p>
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

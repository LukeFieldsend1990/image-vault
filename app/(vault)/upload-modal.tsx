"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { encryptChunk } from "@/lib/crypto/encrypt";

interface Props {
  onClose: () => void;
  onComplete: () => void;
  forTalentId?: string;      // rep uploading on behalf of talent
  resumePackageId?: string;  // if set, opens in resume mode for this package
}

type Step = "metadata" | "files";

interface FileProgress {
  file: File | null;         // null until user selects it (resume mode)
  fileId: string | null;     // known in resume mode; set after initiate in new mode
  filename: string;          // always known
  sizeBytes: number;         // always known
  uploaded: number;          // total bytes uploaded (prev sessions + current)
  status: "needs-file" | "pending" | "uploading" | "complete" | "error";
  startFromPart: number;     // 0-indexed: skip parts 0..(startFromPart-1)
  totalParts: number;
  error?: string;
}

const CHUNK_SIZE = 52_428_800; // 50 MB

// Retry a fetch once after a silent JWT refresh on 401 (long uploads outlast 15-min JWT)
async function fetchWithRefresh(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status !== 401) return res;
  try { await fetch("/api/auth/refresh?next=/dashboard", { redirect: "follow" }); } catch { /* ignore */ }
  return fetch(input, init);
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function UploadModal({
  onClose,
  onComplete,
  forTalentId,
  resumePackageId,
}: Props) {
  const isResumeMode = !!resumePackageId;
  const [step, setStep] = useState<Step>(isResumeMode ? "files" : "metadata");

  // Metadata fields (new mode only)
  const [name, setName] = useState("");
  const [captureDate, setCaptureDate] = useState("");
  const [studioName, setStudioName] = useState("");
  const [technicianNotes, setTechnicianNotes] = useState("");
  const [metaError, setMetaError] = useState("");
  const [metaLoading, setMetaLoading] = useState(false);

  // Package & upload state
  const [packageId, setPackageId] = useState<string | null>(
    resumePackageId ?? null
  );
  const [files, setFiles] = useState<FileProgress[]>([]);
  const [resumeLoading, setResumeLoading] = useState(isResumeMode);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [completedCount, setCompletedCount] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Load resume state on mount ───────────────────────────────────────
  useEffect(() => {
    if (!resumePackageId) return;
    void (async () => {
      try {
        const res = await fetch(
          `/api/vault/upload/status?packageId=${resumePackageId}`
        );
        if (!res.ok) return;
        const data = await res.json() as {
          files: {
            fileId: string;
            filename: string;
            sizeBytes: number;
            uploadStatus: string;
            completedPartsCount: number;
            totalParts: number;
            hasActiveSession: boolean;
          }[];
        };

        const loaded: FileProgress[] = data.files.map((f) => ({
          file: null,
          fileId: f.fileId,
          filename: f.filename,
          sizeBytes: f.sizeBytes,
          // Approximate already-uploaded bytes from completed parts
          uploaded: Math.min(f.completedPartsCount * CHUNK_SIZE, f.sizeBytes),
          status:
            f.uploadStatus === "complete"
              ? "complete"
              : f.hasActiveSession
                ? "needs-file"
                : "error",
          startFromPart: f.completedPartsCount,
          totalParts: f.totalParts,
          error:
            !f.hasActiveSession && f.uploadStatus !== "complete"
              ? "Upload session expired — delete this file and re-upload"
              : undefined,
        }));
        setFiles(loaded);
      } finally {
        setResumeLoading(false);
      }
    })();
  }, [resumePackageId]);

  // ── Step 1: submit metadata (new mode only) ──────────────────────────
  async function handleMetadataSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setMetaError("Package name is required.");
      return;
    }
    setMetaError("");
    setMetaLoading(true);
    try {
      const res = await fetchWithRefresh("/api/vault/packages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          studioName: studioName.trim() || undefined,
          technicianNotes: technicianNotes.trim() || undefined,
          captureDate: captureDate
            ? Math.floor(new Date(captureDate).getTime() / 1000)
            : undefined,
          forTalentId: forTalentId ?? undefined,
        }),
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        setMetaError(json.error ?? "Failed to create package.");
        return;
      }
      const json = await res.json() as { packageId: string };
      setPackageId(json.packageId);
      setStep("files");
    } catch {
      setMetaError("Network error. Please try again.");
    } finally {
      setMetaLoading(false);
    }
  }

  // ── File selection ───────────────────────────────────────────────────
  const addFiles = useCallback(
    (incoming: FileList | File[] | null) => {
      if (!incoming) return;

      if (isResumeMode) {
        // Match selected files to pending resume entries by filename + size
        setFiles((prev) => {
          const updated = [...prev];
          for (const selectedFile of Array.from(incoming)) {
            const idx = updated.findIndex(
              (fp) =>
                fp.status === "needs-file" &&
                fp.filename === selectedFile.name &&
                fp.sizeBytes === selectedFile.size
            );
            if (idx !== -1) {
              updated[idx] = {
                ...updated[idx],
                file: selectedFile,
                status: "pending",
              };
            }
          }
          return updated;
        });
      } else {
        // New upload: add files as fresh entries
        const added: FileProgress[] = Array.from(incoming).map((f) => ({
          file: f,
          fileId: null,
          filename: f.name,
          sizeBytes: f.size,
          uploaded: 0,
          status: "pending",
          startFromPart: 0,
          totalParts: Math.ceil(f.size / CHUNK_SIZE),
        }));
        setFiles((prev) => [...prev, ...added]);
      }
    },
    [isResumeMode]
  );

  const [dropWarning, setDropWarning] = useState<string | null>(null);

  // Recursively read all files from a dropped directory entry
  async function readDirFiles(entry: FileSystemDirectoryEntry): Promise<File[]> {
    const results: File[] = [];
    const reader = entry.createReader();
    const readBatch = (): Promise<FileSystemEntry[]> =>
      new Promise((res, rej) => reader.readEntries(res, rej));
    let batch: FileSystemEntry[];
    do {
      batch = await readBatch();
      for (const child of batch) {
        if (child.isFile) {
          const file = await new Promise<File>((res, rej) =>
            (child as FileSystemFileEntry).file(res, rej)
          );
          results.push(file);
        } else if (child.isDirectory) {
          results.push(...await readDirFiles(child as FileSystemDirectoryEntry));
        }
      }
    } while (batch.length > 0);
    return results;
  }

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      setDropWarning(null);

      const items = Array.from(e.dataTransfer.items);
      const accepted: File[] = [];
      let dirCount = 0;
      let expandedFileCount = 0;

      for (const item of items) {
        if (item.kind !== "file") continue;
        const entry = item.webkitGetAsEntry?.();
        if (entry && entry.isDirectory) {
          dirCount++;
          try {
            const dirFiles = await readDirFiles(entry as FileSystemDirectoryEntry);
            accepted.push(...dirFiles);
            expandedFileCount += dirFiles.length;
          } catch {
            setDropWarning("Could not read folder contents. Try dropping files individually or as a .zip.");
          }
        } else {
          const file = item.getAsFile();
          if (file) accepted.push(file);
        }
      }

      if (dirCount > 0 && expandedFileCount > 0) {
        setDropWarning(
          `${dirCount} folder${dirCount > 1 ? "s" : ""} expanded — ${expandedFileCount} file${expandedFileCount !== 1 ? "s" : ""} added.`
        );
      }

      addFiles(accepted);
    },
    [addFiles] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ── Upload loop ──────────────────────────────────────────────────────
  async function handleUpload() {
    if (!packageId || uploading) return;
    const workable = files.filter((f) => f.status === "pending");
    if (workable.length === 0) return;

    setUploading(true);
    setUploadError("");
    let done = completedCount;

    for (let i = 0; i < files.length; i++) {
      const fp = files[i];
      // Skip complete, needs-file, and errored-expired files
      if (fp.status !== "pending") continue;
      if (!fp.file) continue;

      try {
        let fileId: string;
        let startFromPart: number;

        if (fp.fileId) {
          // Resume existing multipart session — no need to call initiate
          fileId = fp.fileId;
          startFromPart = fp.startFromPart;
        } else {
          // New file — initiate a fresh multipart upload
          const initiateRes = await fetchWithRefresh("/api/vault/upload/initiate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              packageId,
              filename: fp.filename,
              sizeBytes: fp.sizeBytes,
              contentType: fp.file.type || "application/octet-stream",
            }),
          });
          if (!initiateRes.ok) {
            const errJson = await initiateRes.json().catch(() => ({})) as { error?: string };
            throw new Error(errJson.error ?? `Failed to initiate upload (${initiateRes.status})`);
          }
          const initiated = await initiateRes.json() as { fileId: string };
          fileId = initiated.fileId;
          startFromPart = 0;
          // Persist fileId in state so a retry knows the session
          setFiles((prev) =>
            prev.map((f, idx) => (idx === i ? { ...f, fileId } : f))
          );
        }

        setFiles((prev) =>
          prev.map((f, idx) =>
            idx === i ? { ...f, status: "uploading" } : f
          )
        );

        const totalChunks = fp.totalParts;
        // Initialise progress including already-uploaded parts
        let uploadedBytes = Math.min(startFromPart * CHUNK_SIZE, fp.sizeBytes);

        setFiles((prev) =>
          prev.map((f, idx) =>
            idx === i ? { ...f, uploaded: uploadedBytes } : f
          )
        );

        for (let part = startFromPart; part < totalChunks; part++) {
          const start = part * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, fp.sizeBytes);
          const slice = fp.file.slice(start, end);
          const raw = await slice.arrayBuffer();
          const encrypted = await encryptChunk(raw);

          // Get presigned URL for this part
          const presignRes = await fetchWithRefresh(
            `/api/vault/upload/presign?fileId=${fileId}&partNumber=${part + 1}`
          );
          if (!presignRes.ok) {
            throw new Error(`Failed to get presigned URL for part ${part + 1}`);
          }
          const { url: presignedUrl } = await presignRes.json() as { url: string };

          // Upload chunk directly to R2
          const r2Res = await fetch(presignedUrl, {
            method: "PUT",
            body: encrypted,
            headers: { "Content-Type": "application/octet-stream" },
          });
          if (!r2Res.ok) {
            throw new Error(
              `Part ${part + 1} upload to R2 failed (${r2Res.status})`
            );
          }

          const etag =
            r2Res.headers.get("ETag") ?? r2Res.headers.get("etag");
          if (!etag) {
            throw new Error(`No ETag received for part ${part + 1}`);
          }

          // Record ETag in DB
          const recordRes = await fetchWithRefresh(
            `/api/vault/upload/part?fileId=${fileId}&partNumber=${part + 1}&etag=${encodeURIComponent(etag)}`,
            { method: "PATCH" }
          );
          if (!recordRes.ok) {
            throw new Error(`Failed to record part ${part + 1}`);
          }

          uploadedBytes += end - start;
          setFiles((prev) =>
            prev.map((f, idx) =>
              idx === i ? { ...f, uploaded: uploadedBytes } : f
            )
          );
        }

        // Complete the multipart upload
        const completeRes = await fetchWithRefresh("/api/vault/upload/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileId }),
        });
        if (!completeRes.ok) throw new Error("Failed to complete upload");

        setFiles((prev) =>
          prev.map((f, idx) =>
            idx === i
              ? { ...f, status: "complete", uploaded: fp.sizeBytes }
              : f
          )
        );
        done++;
        setCompletedCount(done);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        setFiles((prev) =>
          prev.map((f, idx) =>
            idx === i ? { ...f, status: "error", error: msg } : f
          )
        );
      }
    }

    setUploading(false);
    if (done > 0) onComplete();
  }

  // ── Derived state ────────────────────────────────────────────────────
  const pendingFiles = files.filter((f) => f.status === "pending");
  const needsFileCount = files.filter((f) => f.status === "needs-file").length;
  const allDone = files.length > 0 && files.every((f) => f.status === "complete");

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-hidden
      />

      {/* Panel */}
      <div
        className="relative w-full max-w-lg rounded-sm border shadow-2xl"
        style={{ background: "var(--color-bg)", borderColor: "var(--color-border)" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-6 py-4"
          style={{ borderColor: "var(--color-border)" }}
        >
          <h2 className="text-sm font-semibold text-[--color-ink]">
            {step === "metadata"
              ? "New Scan Package"
              : isResumeMode
                ? "Resume Upload"
                : "Upload Files"}
          </h2>
          <button
            onClick={onClose}
            className="text-[--color-muted] hover:text-[--color-ink] transition-colors"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {step === "metadata" ? (
            /* ── New package metadata form ─────────────────────────── */
            <form onSubmit={handleMetadataSubmit} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-medium text-[--color-ink] mb-1.5">
                  Package name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Full-body scan — Jan 2026"
                  className="w-full border px-3 py-2 text-xs text-[--color-ink] bg-transparent placeholder:text-[--color-muted] focus:outline-none focus:ring-1 focus:ring-[--color-accent]"
                  style={{ borderColor: "var(--color-border)", borderRadius: "var(--radius)" }}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[--color-ink] mb-1.5">
                  Capture date
                </label>
                <input
                  type="date"
                  value={captureDate}
                  onChange={(e) => setCaptureDate(e.target.value)}
                  className="w-full border px-3 py-2 text-xs text-[--color-ink] bg-transparent focus:outline-none focus:ring-1 focus:ring-[--color-accent]"
                  style={{ borderColor: "var(--color-border)", borderRadius: "var(--radius)" }}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[--color-ink] mb-1.5">
                  Studio / facility
                </label>
                <input
                  type="text"
                  value={studioName}
                  onChange={(e) => setStudioName(e.target.value)}
                  placeholder="e.g. 4D Studios London"
                  className="w-full border px-3 py-2 text-xs text-[--color-ink] bg-transparent placeholder:text-[--color-muted] focus:outline-none focus:ring-1 focus:ring-[--color-accent]"
                  style={{ borderColor: "var(--color-border)", borderRadius: "var(--radius)" }}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[--color-ink] mb-1.5">
                  Technician notes
                </label>
                <textarea
                  value={technicianNotes}
                  onChange={(e) => setTechnicianNotes(e.target.value)}
                  rows={3}
                  placeholder="Optional notes from the scanning technician…"
                  className="w-full border px-3 py-2 text-xs text-[--color-ink] bg-transparent placeholder:text-[--color-muted] resize-none focus:outline-none focus:ring-1 focus:ring-[--color-accent]"
                  style={{ borderColor: "var(--color-border)", borderRadius: "var(--radius)" }}
                />
              </div>
              {metaError && <p className="text-xs text-red-500">{metaError}</p>}
              <div className="flex justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs text-[--color-muted] hover:text-[--color-ink] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={metaLoading}
                  className="px-5 py-2 text-xs font-medium text-white transition disabled:opacity-50"
                  style={{ background: "var(--color-ink)", borderRadius: "var(--radius)" }}
                >
                  {metaLoading ? "Creating…" : "Continue"}
                </button>
              </div>
            </form>
          ) : resumeLoading ? (
            /* ── Resume loading state ──────────────────────────────── */
            <div className="py-8 flex items-center justify-center">
              <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                Loading upload state…
              </p>
            </div>
          ) : (
            /* ── File upload step ──────────────────────────────────── */
            <div className="flex flex-col gap-4">
              {/* Resume hint banner */}
              {isResumeMode && needsFileCount > 0 && (
                <div
                  className="rounded border px-3 py-2.5 text-xs"
                  style={{
                    borderColor: "var(--color-border)",
                    background: "var(--color-surface)",
                    color: "var(--color-muted)",
                  }}
                >
                  Re-select{" "}
                  <strong style={{ color: "var(--color-ink)" }}>
                    {needsFileCount} file{needsFileCount !== 1 ? "s" : ""}
                  </strong>{" "}
                  from your device to resume. Completed chunks will be skipped.
                </div>
              )}

              {/* Directory drop warning */}
              {dropWarning && (
                <div
                  className="rounded border px-3 py-2 text-xs flex items-start gap-2"
                  style={{ borderColor: "rgba(217,119,6,0.3)", background: "rgba(217,119,6,0.06)", color: "#d97706" }}
                >
                  <svg width="13" height="13" className="mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  {dropWarning}
                </div>
              )}

              {/* Drag-and-drop zone — hidden once all files matched in resume mode */}
              {(!isResumeMode || needsFileCount > 0) && (
                <div
                  onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className="cursor-pointer border-2 border-dashed rounded-sm flex flex-col items-center justify-center py-8 gap-2 transition-colors"
                  style={{
                    borderColor: isDragOver ? "var(--color-ink)" : "var(--color-border)",
                    background: isDragOver ? "var(--color-surface)" : "transparent",
                  }}
                >
                  <svg
                    width="24" height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ color: "var(--color-muted)" }}
                  >
                    <polyline points="16 16 12 12 8 16" />
                    <line x1="12" y1="12" x2="12" y2="21" />
                    <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
                  </svg>
                  <p className="text-xs text-[--color-muted]">
                    {isResumeMode
                      ? <>Re-select files or <span className="underline text-[--color-ink]">browse</span></>
                      : <>Drag files here or <span className="underline text-[--color-ink]">browse</span></>
                    }
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => addFiles(e.target.files)}
                  />
                </div>
              )}

              {/* File list */}
              {files.length > 0 && (
                <div className="flex flex-col gap-2 max-h-60 overflow-y-auto pr-1">
                  {files.map((fp, i) => (
                    <div key={i} className="flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <span
                          className={`text-xs truncate max-w-[70%] ${fp.status === "complete" ? "opacity-50" : ""}`}
                          style={{ color: "var(--color-ink)" }}
                        >
                          {fp.filename}
                        </span>
                        <span className="text-[11px] shrink-0 ml-2" style={{ color: "var(--color-muted)" }}>
                          {fp.status === "complete"
                            ? formatBytes(fp.sizeBytes)
                            : fp.status === "uploading"
                              ? `${formatBytes(fp.uploaded)} / ${formatBytes(fp.sizeBytes)}`
                              : fp.status === "needs-file"
                                ? `${formatBytes(fp.startFromPart * CHUNK_SIZE)} done — re-select`
                                : fp.status === "error"
                                  ? "Error"
                                  : fp.startFromPart > 0
                                    ? `Resuming from part ${fp.startFromPart + 1}/${fp.totalParts}`
                                    : formatBytes(fp.sizeBytes)}
                        </span>
                      </div>

                      {/* Progress bar */}
                      {(fp.status === "uploading" || fp.status === "complete" || fp.startFromPart > 0) && (
                        <div
                          className="h-0.5 rounded-full overflow-hidden"
                          style={{ background: "var(--color-border)" }}
                        >
                          <div
                            className="h-full transition-all duration-300"
                            style={{
                              width: `${fp.status === "complete"
                                ? 100
                                : Math.round((fp.uploaded / fp.sizeBytes) * 100)}%`,
                              background:
                                fp.status === "complete"
                                  ? "var(--color-accent)"
                                  : "var(--color-ink)",
                            }}
                          />
                        </div>
                      )}

                      {fp.status === "needs-file" && (
                        <p className="text-[10px]" style={{ color: "#d97706" }}>
                          Waiting for file — drag or browse above
                        </p>
                      )}
                      {fp.status === "error" && (
                        <p className="text-[10px] text-red-500">{fp.error}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Counter */}
              {uploading && (
                <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                  {completedCount} of {files.filter((f) => f.status !== "needs-file").length}{" "}
                  file{files.length !== 1 ? "s" : ""} complete
                </p>
              )}

              {uploadError && (
                <p className="text-xs text-red-500">{uploadError}</p>
              )}

              <div className="flex justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={uploading}
                  className="px-4 py-2 text-xs text-[--color-muted] hover:text-[--color-ink] transition-colors disabled:opacity-40"
                >
                  {allDone ? "Close" : "Cancel"}
                </button>
                {!allDone && (
                  <button
                    type="button"
                    onClick={handleUpload}
                    disabled={pendingFiles.length === 0 || uploading}
                    className="px-5 py-2 text-xs font-medium text-white transition disabled:opacity-50"
                    style={{
                      background: "var(--color-ink)",
                      borderRadius: "var(--radius)",
                    }}
                  >
                    {uploading
                      ? "Uploading…"
                      : isResumeMode
                        ? `Resume${pendingFiles.length > 0 ? ` (${pendingFiles.length} file${pendingFiles.length !== 1 ? "s" : ""})` : ""}`
                        : "Upload"}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Render-bridge grant-manifest file helpers.
 *
 * The grant manifest keys per-file integrity checks (size / sha256) by `path`,
 * which is set to the file's bare `filename`. A package can legitimately end up
 * with more than one *completed* `scan_files` row that shares the same filename:
 * re-uploading a file mints a fresh `fileId` / `r2Key` but nothing supersedes
 * the previous row, and there is no unique constraint on `(packageId, filename)`.
 *
 * When two completed rows share a filename, the manifest used to emit both at
 * the same `path`. The bridge agent writes them to a single on-disk location
 * (last write wins) but builds an expected-size/hash map keyed by path, so the
 * surviving disk file gets compared against whichever duplicate the agent
 * happened to resolve last — producing mass false `tamper_detected` events
 * (every file in the package flags, sizes off by a few KB each pass).
 *
 * Collapsing each path to a single canonical row removes the ambiguity. We keep
 * the most recently completed upload — the bytes that actually land on disk —
 * falling back to creation time and finally fileId for a fully deterministic
 * choice.
 */
export interface ManifestFileRow {
  id: string;
  filename: string;
  completedAt?: number | null;
  createdAt?: number | null;
}

/** True when `a` should win over the currently-kept `b` for the same path. */
function isNewer(a: ManifestFileRow, b: ManifestFileRow): boolean {
  const aCompleted = a.completedAt ?? 0;
  const bCompleted = b.completedAt ?? 0;
  if (aCompleted !== bCompleted) return aCompleted > bCompleted;

  const aCreated = a.createdAt ?? 0;
  const bCreated = b.createdAt ?? 0;
  if (aCreated !== bCreated) return aCreated > bCreated;

  // Stable, deterministic tiebreak so repeated grant requests are identical.
  return a.id > b.id;
}

/**
 * Collapse files sharing the same `path` (filename) down to one canonical row
 * per path. Input order of the surviving rows is preserved.
 */
export function dedupeFilesByPath<T extends ManifestFileRow>(files: T[]): T[] {
  const winners = new Map<string, T>();
  for (const f of files) {
    const existing = winners.get(f.filename);
    if (!existing || isNewer(f, existing)) {
      winners.set(f.filename, f);
    }
  }
  return files.filter((f) => winners.get(f.filename) === f);
}

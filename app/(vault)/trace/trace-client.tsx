"use client";

import { useState } from "react";
import Link from "next/link";
import Inlay from "@/app/components/inlay";
import { fmtBytes, isoUtc, quads, shortHash } from "@/lib/documents/palette";
import type { TraceMatch, TraceRelease, TraceResult } from "@/lib/forensics/trace";

const card = "rounded p-4";
const cardStyle = { border: "1px solid var(--color-border)", background: "var(--color-surface)" };
const eyebrow = "text-[10px] font-semibold tracking-widest uppercase";

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className={eyebrow} style={{ color: "var(--color-muted)", margin: 0 }}>{label}</p>
      <p
        className="mt-0.5 break-words"
        style={{
          fontSize: mono ? 11.5 : 13,
          fontFamily: mono ? "var(--font-mono)" : undefined,
          color: "var(--color-ink)",
          margin: 0,
        }}
      >
        {value}
      </p>
    </div>
  );
}

function ReleaseRow({ r }: { r: TraceRelease }) {
  return (
    <div
      className="py-3 flex items-start justify-between gap-4 flex-wrap"
      style={{ borderBottom: "1px solid var(--color-border)" }}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
            {r.recipientEmail}
          </span>
          {r.selfDownload && (
            <span
              className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{ background: "var(--color-surface)", color: "var(--color-muted)", border: "1px solid var(--color-border)" }}
            >
              performer&apos;s own download
            </span>
          )}
          {!r.completedAt && (
            <span
              className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{ background: "var(--color-expiring-tint)", color: "var(--color-expiring)" }}
            >
              never completed
            </span>
          )}
        </div>
        {r.projectName && (
          <p className="text-xs mt-1" style={{ color: "var(--color-text)" }}>
            {r.projectName}
            {r.productionCompany ? ` — ${r.productionCompany}` : ""}
          </p>
        )}
        <p className="text-[11px] font-mono mt-1" style={{ color: "var(--color-muted)" }}>
          {r.ip ?? "no IP recorded"}
          {r.bytesTransferred != null ? ` · ${fmtBytes(r.bytesTransferred)}` : ""}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-[11px] font-mono" style={{ color: "var(--color-muted)" }}>{isoUtc(r.startedAt)}</p>
        {r.licenceId && (
          <Link
            href={`/licences/${r.licenceId}`}
            className="text-[11px] font-medium"
            style={{ color: "var(--color-accent)" }}
          >
            View licence →
          </Link>
        )}
      </div>
    </div>
  );
}

function MatchCard({ m }: { m: TraceMatch }) {
  const named = m.attribution === "recipient" && m.identifiedRecipient;
  const tone = named ? "var(--color-danger)" : "var(--color-expiring)";
  const tint = named ? "var(--color-accent-tint)" : "var(--color-expiring-tint)";

  return (
    <div className="rounded" style={{ border: `1px solid ${tone}`, background: "var(--color-bg)" }}>
      {/* Verdict strip */}
      <div className="px-5 py-4" style={{ background: tint, borderBottom: `1px solid ${tone}` }}>
        <p className={eyebrow} style={{ color: tone, margin: 0 }}>
          {named ? "Recipient identified" : "File identified"}
        </p>
        <p className="text-sm mt-1.5" style={{ color: "var(--color-ink)", lineHeight: 1.6 }}>
          {named ? (
            <>
              The watermark in this artifact is unique to the copy issued to{" "}
              <strong>{m.identifiedRecipient!.licenseeEmail ?? "an identified licensee"}</strong>
              {m.identifiedRecipient!.productionCompany
                ? ` at ${m.identifiedRecipient!.productionCompany}`
                : ""}
              .
            </>
          ) : (
            <>
              The bytes are identical to <strong>{m.file.filename}</strong> in{" "}
              {m.file.talentName ?? "a performer"}&apos;s vault. Matched on content hash, so this
              names the file — not which recipient released it.
            </>
          )}
        </p>
        <p className="text-[11px] mt-1.5 font-mono" style={{ color: "var(--color-muted)" }}>
          matched by {m.matchedBy === "sha256" ? "SHA-256 content hash" : "geometry watermark"}
        </p>
      </div>

      <div className="p-5 space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="File" value={m.file.filename} mono />
          <Field label="Size" value={fmtBytes(m.file.sizeBytes)} />
          <Field label="Performer" value={m.file.talentName ?? m.file.talentEmail ?? "—"} />
          <Field label="Scan package" value={m.file.packageName} />
          {m.file.sha256 && (
            <div className="sm:col-span-2">
              <Field label="SHA-256" value={quads(m.file.sha256)} mono />
            </div>
          )}
        </div>

        {named && (
          <div className={card} style={{ ...cardStyle, borderLeft: `3px solid ${tone}` }}>
            <p className={eyebrow} style={{ color: "var(--color-muted)", margin: "0 0 10px" }}>
              Watermark issuance
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Issued to" value={m.identifiedRecipient!.licenseeEmail ?? "—"} />
              <Field label="Production" value={m.identifiedRecipient!.projectName ?? "—"} />
              <Field label="Company" value={m.identifiedRecipient!.productionCompany ?? "—"} />
              <Field label="Issued" value={isoUtc(m.identifiedRecipient!.issuedAt)} mono />
            </div>
            <div className="mt-3">
              <Link
                href={`/licences/${m.identifiedRecipient!.licenceId}`}
                className="text-xs font-medium"
                style={{ color: "var(--color-accent)" }}
              >
                Open the licence →
              </Link>
            </div>
          </div>
        )}

        <div>
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <p className={eyebrow} style={{ color: "var(--color-muted)", margin: 0 }}>
              Recorded releases ({m.releases.length})
            </p>
            <Link
              href={`/vault/packages/${m.file.packageId}/chain-of-custody`}
              className="text-[11px] font-medium"
              style={{ color: "var(--color-accent)" }}
            >
              Full chain of custody →
            </Link>
          </div>
          {m.releases.length === 0 ? (
            <p className="text-sm mt-2" style={{ color: "var(--color-muted)", lineHeight: 1.6 }}>
              No release of this file is on record. If it left the platform, it did so by a
              route that is not logged — worth investigating on its own.
            </p>
          ) : (
            <div>
              {m.releases.map((r) => (
                <ReleaseRow key={r.downloadEventId} r={r} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TraceClient() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<TraceResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch("/api/forensics/trace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const d = (await r.json()) as TraceResult & { error?: string };
      if (!r.ok) {
        setError(d.error ?? `Trace failed (${r.status})`);
        return;
      }
      setResult(d);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
          Trace a file
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)", lineHeight: 1.65, maxWidth: "64ch" }}>
          You have a scan file that turned up somewhere it shouldn&apos;t. Paste its
          SHA-256 hash, or the watermark payload recovered by the geometry detector,
          and this will tell you which scan it is and who it was released to.
        </p>
      </div>

      <Inlay eyebrow="Trace-back" gate footnote="Content hash · Geometry watermark · UTC">
        Every copy we release is <em>marked and accounted for.</em>
      </Inlay>

      <form onSubmit={run} className={card} style={cardStyle}>
        <label className={eyebrow} style={{ color: "var(--color-muted)" }} htmlFor="trace-q">
          Hash or watermark payload
        </label>
        <input
          id="trace-q"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. 3b70e2a9f1c4…  (64 hex characters)"
          spellCheck={false}
          autoComplete="off"
          className="w-full rounded border px-3 py-2 text-sm outline-none focus:ring-1 transition mt-1.5"
          style={{
            background: "var(--color-bg)",
            borderColor: "var(--color-border)",
            color: "var(--color-ink)",
            fontFamily: "var(--font-mono)",
          }}
        />
        <div className="flex items-center gap-3 mt-3 flex-wrap">
          <button
            type="submit"
            disabled={busy || !query.trim()}
            className="rounded px-4 py-2 text-sm font-medium text-white transition"
            style={{
              background: busy || !query.trim() ? "var(--color-muted)" : "var(--color-accent)",
              cursor: busy || !query.trim() ? "not-allowed" : "pointer",
            }}
          >
            {busy ? "Tracing…" : "Trace"}
          </button>
          <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
            Compute a hash locally with <code style={{ fontFamily: "var(--font-mono)" }}>shasum -a 256 file.obj</code>
          </p>
        </div>
      </form>

      {error && (
        <p
          className="text-xs rounded px-3 py-2"
          style={{ background: "var(--color-accent-tint)", color: "var(--color-danger)" }}
        >
          {error}
        </p>
      )}

      {result && (
        <div className="space-y-4">
          <div className={card} style={cardStyle}>
            <p className={eyebrow} style={{ color: "var(--color-muted)", margin: "0 0 8px" }}>
              What this establishes
            </p>
            <p className="text-sm" style={{ color: "var(--color-ink)", lineHeight: 1.65 }}>
              {result.conclusion}
            </p>
            <p className="text-[11px] font-mono mt-3" style={{ color: "var(--color-faint)" }}>
              {shortHash(result.query, 16)} · read as{" "}
              {result.queryKind === "sha256"
                ? "a content hash"
                : result.queryKind === "fingerprint"
                  ? "a watermark payload"
                  : "unrecognised"}
            </p>
          </div>

          {result.matches.map((m, i) => (
            <MatchCard key={`${m.file.fileId}-${i}`} m={m} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Document furniture — the shared pieces every Image Vault evidence document
 * is built from.
 *
 * These are deliberately presentational and print-first: fixed colours from
 * lib/documents/palette (not CSS vars), no interactivity, no data fetching.
 * The chain-of-custody record and the consent receipt compose the same set so
 * a reader holding both recognises them as one instrument.
 */

"use client";

import { QRCodeSVG } from "qrcode.react";
import type { ReactNode } from "react";
import { DOC, quads } from "@/lib/documents/palette";

// ── Section eyebrow ───────────────────────────────────────────────────────────

/** A tracked-caps label with a hairline rule running out to the right margin. */
export function DocRule({ label, tone = DOC.muted }: { label: string; tone?: string }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <p
        className="uppercase shrink-0"
        style={{
          fontFamily: DOC.sans,
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.25em",
          color: tone,
          margin: 0,
        }}
      >
        {label}
      </p>
      <div className="flex-1 h-px" style={{ background: DOC.rule }} />
    </div>
  );
}

// ── Metadata grid ─────────────────────────────────────────────────────────────

export interface MetaItem {
  label: string;
  value: ReactNode;
  /** Render the value in the mono face — ids, codes, hashes, timestamps. */
  mono?: boolean;
}

/** The two-column label/value grid that heads every document. */
export function DocMeta({ items, columns = 2 }: { items: MetaItem[]; columns?: number }) {
  return (
    <div
      className="doc-keep p-4 gap-x-6 gap-y-2.5"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        background: DOC.inset,
        borderRadius: 6,
        fontFamily: DOC.sans,
      }}
    >
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <span
            className="uppercase block"
            style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", color: DOC.muted }}
          >
            {it.label}
          </span>
          <p
            className="mt-0.5 break-words"
            style={{
              fontSize: it.mono ? 11 : 12.5,
              fontFamily: it.mono ? DOC.mono : DOC.sans,
              fontWeight: it.mono ? 400 : 600,
              color: DOC.ink,
              margin: 0,
            }}
          >
            {it.value}
          </p>
        </div>
      ))}
    </div>
  );
}

// ── Hashes ────────────────────────────────────────────────────────────────────

/**
 * A digest, grouped so a reader can compare it against a second copy by eye —
 * the whole point of printing a hash. Wraps on the group boundary.
 */
export function HashQuads({
  hash,
  size = 11,
  color = DOC.ink,
}: {
  hash: string | null | undefined;
  size?: number;
  color?: string;
}) {
  if (!hash) {
    return (
      <span style={{ fontFamily: DOC.mono, fontSize: size, color: DOC.faint }}>
        (none)
      </span>
    );
  }
  return (
    <span
      style={{
        fontFamily: DOC.mono,
        fontSize: size,
        lineHeight: 1.6,
        color,
        wordBreak: "break-word",
        letterSpacing: "0.02em",
      }}
    >
      {quads(hash)}
    </span>
  );
}

// ── The seal ──────────────────────────────────────────────────────────────────

export interface TamperSealProps {
  /** The hash sealed into this document at issue time. */
  sealHash: string;
  /** Public verification URL — printed in full and encoded in the QR. */
  verifyUrl: string;
  /** e.g. "3 chains · 41 events · all verified". */
  summary: string;
  /** False when a chain failed to verify at render time. */
  intact: boolean;
  /** Optional line naming what broke, shown only when `intact` is false. */
  breakDetail?: string | null;
}

/**
 * The tamper seal. This is the block that makes the document evidence rather
 * than a report: it states what was hashed, what the hash was at issue, and
 * where anyone can recompute it.
 *
 * The claim is deliberately narrow and must stay that way — the ledger is
 * tamper-EVIDENT (an alteration is detectable), not tamper-proof, and nothing
 * here should imply the platform cannot read the underlying files.
 */
export function TamperSeal({ sealHash, verifyUrl, summary, intact, breakDetail }: TamperSealProps) {
  const tone = intact ? DOC.olive : DOC.brick;
  const tint = intact ? DOC.oliveTint : DOC.brickTint;

  return (
    <div
      className="doc-keep flex gap-5 p-4"
      style={{ border: `1px solid ${DOC.rule}`, borderLeft: `3px solid ${tone}`, borderRadius: 6, background: tint }}
    >
      <div className="flex-1 min-w-0">
        <p
          className="uppercase"
          style={{
            fontFamily: DOC.sans,
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.2em",
            color: tone,
            margin: "0 0 8px",
          }}
        >
          {intact ? "Tamper seal · verified" : "Tamper seal · integrity failure"}
        </p>

        <p style={{ fontFamily: DOC.sans, fontSize: 11.5, color: DOC.text, margin: "0 0 8px", lineHeight: 1.55 }}>
          Every entry below is written to an append-only ledger in which each
          record carries the hash of the one before it. Altering, reordering, or
          removing any entry changes the sealed hash printed here.{" "}
          <span style={{ color: DOC.ink, fontWeight: 600 }}>{summary}</span>
          {!intact && breakDetail ? (
            <>
              {" "}
              <span style={{ color: DOC.brick, fontWeight: 600 }}>{breakDetail}</span>
            </>
          ) : null}
        </p>

        <div style={{ marginBottom: 8 }}>
          <span
            className="uppercase block"
            style={{ fontFamily: DOC.sans, fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", color: DOC.muted }}
          >
            Sealed hash (SHA-256)
          </span>
          <HashQuads hash={sealHash} color={tone} />
        </div>

        <span
          className="uppercase block"
          style={{ fontFamily: DOC.sans, fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", color: DOC.muted }}
        >
          Verify independently
        </span>
        <a
          href={verifyUrl}
          style={{ fontFamily: DOC.mono, fontSize: 10.5, color: DOC.ink, wordBreak: "break-all" }}
        >
          {verifyUrl}
        </a>
      </div>

      <div className="shrink-0 text-center">
        <div style={{ background: "#fff", padding: 6, borderRadius: 4, border: `1px solid ${DOC.rule}` }}>
          <QRCodeSVG value={verifyUrl} size={84} level="M" bgColor="#ffffff" fgColor={DOC.ink} />
        </div>
        <p
          className="uppercase"
          style={{
            fontFamily: DOC.sans,
            fontSize: 8,
            fontWeight: 700,
            letterSpacing: "0.12em",
            color: DOC.muted,
            margin: "6px 0 0",
          }}
        >
          Scan to verify
        </p>
      </div>
    </div>
  );
}

// ── Terminal rule ─────────────────────────────────────────────────────────────

/** Marks the true end of a document, so a short print can't be mistaken for a truncated one. */
export function DocEnd({ label = "End of record" }: { label?: string }) {
  return (
    <div className="doc-keep flex items-center gap-3 mt-8">
      <div className="flex-1 h-px" style={{ background: DOC.rule }} />
      <p
        className="uppercase shrink-0"
        style={{
          fontFamily: DOC.sans,
          fontSize: 8.5,
          fontWeight: 700,
          letterSpacing: "0.28em",
          color: DOC.faint,
          margin: 0,
        }}
      >
        {label}
      </p>
      <div className="flex-1 h-px" style={{ background: DOC.rule }} />
    </div>
  );
}

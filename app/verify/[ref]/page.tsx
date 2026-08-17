import { getDb } from "@/lib/db";
import { verifySealByRef, type SealVerdict } from "@/lib/compliance/seal";
import { quads, isoUtc } from "@/lib/documents/palette";
import Wordmark from "@/app/components/wordmark";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Verify document — ImageVault",
  description: "Check a printed ImageVault evidence document against the live ledger.",
  robots: { index: false, follow: false },
};

const KIND_LABEL: Record<SealVerdict["kind"], string> = {
  custody_record: "Chain of custody record",
  consent_receipt: "Consent receipt",
  certificate: "Compliance certificate",
  probe_report: "Likeness encoding report",
};

interface Look {
  colour: string;
  tint: string;
  headline: string;
  lede: string;
}

const LOOK: Record<SealVerdict["status"], Look> = {
  intact: {
    colour: "var(--color-active)",
    tint: "var(--color-active-tint)",
    headline: "Record intact",
    lede: "This document matches the ledger exactly.",
  },
  appended: {
    colour: "var(--color-expiring)",
    tint: "var(--color-expiring-tint)",
    headline: "Verified — record has grown",
    lede: "Nothing in this document has changed. Events have been added since it was issued.",
  },
  broken: {
    colour: "var(--color-danger)",
    tint: "var(--color-accent-tint)",
    headline: "Seal broken",
    lede: "The ledger no longer matches what this document was issued against.",
  },
  revoked: {
    colour: "var(--color-muted)",
    tint: "var(--color-surface)",
    headline: "Document withdrawn",
    lede: "This document was withdrawn by its issuer.",
  },
};

// ── Presentational pieces ────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--color-bg)", minHeight: "100vh" }}>
      <div className="mx-auto px-5 py-14 sm:py-20" style={{ maxWidth: 640 }}>
        <div className="mb-10 flex justify-center">
          <Wordmark variant="lock" style={{ fontSize: 11 }} />
        </div>
        {children}
        <p
          className="mt-10 text-center"
          style={{ fontSize: 11, lineHeight: 1.7, color: "var(--color-muted)" }}
        >
          This page confirms whether a document still matches the record it was
          issued from. It does not show the contents of that record, and it does
          not identify the people named in the document.
        </p>
      </div>
    </div>
  );
}

function Eyebrow({ children, colour }: { children: React.ReactNode; colour?: string }) {
  return (
    <p
      className="uppercase"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        letterSpacing: "0.18em",
        color: colour ?? "var(--color-muted)",
        margin: 0,
      }}
    >
      {children}
    </p>
  );
}

/** The gate device at display size — the brand's mark of a threshold held. */
function GateMark({ colour, broken }: { colour: string; broken?: boolean }) {
  return (
    <span className="flex items-stretch" style={{ gap: 5, height: 34 }} aria-hidden>
      <span style={{ width: 5, borderRadius: 2.5, background: colour }} />
      <span
        style={{
          width: 5,
          borderRadius: 2.5,
          background: colour,
          transform: broken ? "translateY(6px) rotate(9deg)" : undefined,
          opacity: broken ? 0.55 : 1,
        }}
      />
    </span>
  );
}

function HashPanel({
  label,
  hash,
  colour,
  muted,
}: {
  label: string;
  hash: string;
  colour: string;
  muted?: boolean;
}) {
  return (
    <div
      className="p-3.5"
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        background: "var(--color-bg)",
      }}
    >
      <p
        className="uppercase"
        style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: "0.14em",
          color: "var(--color-muted)",
          margin: "0 0 6px",
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          lineHeight: 1.65,
          letterSpacing: "0.02em",
          color: muted ? "var(--color-muted)" : colour,
          margin: 0,
          wordBreak: "break-word",
        }}
      >
        {hash ? quads(hash) : "—"}
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      className="flex items-baseline justify-between gap-4 py-2.5"
      style={{ borderBottom: "1px solid var(--color-border)" }}
    >
      <span
        className="uppercase shrink-0"
        style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.12em", color: "var(--color-muted)" }}
      >
        {label}
      </span>
      <span
        className="text-right"
        style={{ fontSize: 12.5, color: "var(--color-ink)", fontFamily: "var(--font-mono)" }}
      >
        {value}
      </span>
    </div>
  );
}

// ── Not found ────────────────────────────────────────────────────────────────

function NotFound() {
  return (
    <Shell>
      <div
        className="p-8 text-center"
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius)",
          background: "var(--color-surface)",
        }}
      >
        <Eyebrow>Document verification</Eyebrow>
        <h1
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 26,
            fontWeight: 600,
            color: "var(--color-ink)",
            margin: "14px 0 8px",
          }}
        >
          No such document
        </h1>
        <p style={{ fontSize: 13, lineHeight: 1.65, color: "var(--color-text)", margin: 0 }}>
          This reference does not correspond to any document issued by ImageVault.
          Check that the whole reference was copied — it is 22 characters and is
          case-sensitive.
        </p>
      </div>
    </Shell>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function VerifyPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;

  if (!/^[A-Za-z0-9]{16,40}$/.test(ref)) return <NotFound />;

  const db = getDb();
  const verdict = await verifySealByRef(db, ref);
  if (!verdict) return <NotFound />;

  const look = LOOK[verdict.status];
  const matched = verdict.status === "intact";
  const failed = verdict.status === "broken";

  return (
    <Shell>
      {/* ── The verdict ── */}
      <div
        className="px-7 py-8 sm:px-9 sm:py-10"
        style={{
          border: `1px solid ${look.colour}`,
          borderTop: `4px solid ${look.colour}`,
          borderRadius: "var(--radius)",
          background: look.tint,
        }}
      >
        <div className="flex items-center gap-4 mb-5">
          <GateMark colour={look.colour} broken={failed} />
          <div className="min-w-0">
            <Eyebrow colour={look.colour}>{KIND_LABEL[verdict.kind]}</Eyebrow>
            <h1
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: "clamp(26px, 4.6vw, 34px)",
                fontWeight: 600,
                letterSpacing: "-0.015em",
                lineHeight: 1.1,
                color: look.colour,
                margin: "6px 0 0",
              }}
            >
              {look.headline}
            </h1>
          </div>
        </div>

        <p style={{ fontSize: 15, lineHeight: 1.6, color: "var(--color-ink)", margin: "0 0 6px", fontWeight: 500 }}>
          {look.lede}
        </p>
        <p style={{ fontSize: 13, lineHeight: 1.65, color: "var(--color-text)", margin: 0 }}>
          {verdict.detail}
        </p>
      </div>

      {/* ── The evidence ── */}
      <div
        className="mt-5 p-5 sm:p-6"
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius)",
          background: "var(--color-surface)",
        }}
      >
        <p
          className="uppercase"
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.22em",
            color: "var(--color-muted)",
            margin: "0 0 12px",
          }}
        >
          Hashes compared
        </p>

        <div className="grid gap-3" style={{ gridTemplateColumns: "1fr" }}>
          <HashPanel label="Sealed into the document at issue" hash={verdict.sealedHash} colour="var(--color-ink)" />
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px" style={{ background: "var(--color-border)" }} />
            <span
              className="uppercase"
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.14em",
                color: matched ? "var(--color-active)" : look.colour,
              }}
            >
              {matched ? "Identical" : "Differs"}
            </span>
            <div className="flex-1 h-px" style={{ background: "var(--color-border)" }} />
          </div>
          <HashPanel
            label="Recomputed from the ledger just now"
            hash={verdict.currentHash}
            colour={matched ? "var(--color-active)" : look.colour}
            muted={verdict.status === "revoked"}
          />
        </div>

        <div className="mt-6">
          <Row label="Document" value={KIND_LABEL[verdict.kind]} />
          <Row label="Subject" value={verdict.subjectLabel ?? "—"} />
          <Row label="Issued" value={isoUtc(verdict.issuedAt)} />
          <Row label="Checked" value={isoUtc(verdict.verifiedAt)} />
          <Row
            label="Entries"
            value={
              verdict.currentEventCount === verdict.sealedEventCount
                ? String(verdict.sealedEventCount)
                : `${verdict.sealedEventCount} at issue · ${verdict.currentEventCount} now`
            }
          />
          <Row label="Reference" value={ref} />
        </div>
      </div>

      {/* ── What was checked ── */}
      <div className="mt-5 px-1">
        <p
          className="uppercase"
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.22em",
            color: "var(--color-muted)",
            margin: "0 0 10px",
          }}
        >
          What was checked
        </p>
        <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {[
            "Every entry was re-hashed from its own contents and compared with the hash stored against it.",
            "Each entry's recorded link to the entry before it was followed from the first entry onward, so that a removed or reordered entry breaks the sequence.",
            "The resulting chain tips were combined into a single hash and compared with the one printed on the document.",
          ].map((line, i) => (
            <li key={i} className="flex gap-3 py-1.5">
              <span
                className="shrink-0"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  color: "var(--color-faint)",
                  paddingTop: 2,
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--color-text)" }}>{line}</span>
            </li>
          ))}
        </ol>
      </div>
    </Shell>
  );
}

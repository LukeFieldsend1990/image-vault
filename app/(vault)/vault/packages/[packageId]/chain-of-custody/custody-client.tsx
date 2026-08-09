"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Inlay from "@/app/components/inlay";
import Wordmark from "@/app/components/wordmark";
import { DocEnd, DocMeta, DocRule, HashQuads, TamperSeal } from "@/app/components/seal";
import {
  DOC,
  DOC_PRINT_CSS,
  TONE_COLOR,
  docDate,
  docRef as buildDocRef,
  eventTone,
  fmtBytes,
  isoUtc,
  quads,
  shortHash,
  type Tone,
} from "@/lib/documents/palette";
import type {
  ActivityResponse,
  CustodyEvent,
} from "@/app/api/vault/packages/[packageId]/activity/route";

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** A ledger-backed row is one that carries a position in the hash chain. */
function isLedgerEvent(e: CustodyEvent): boolean {
  return e.type === "compliance_event" && typeof e.hash === "string" && e.hash.length > 0;
}

// ── Event vocabulary ───────────────────────────────────────────────────────────

const EVENT_LABEL: Record<CustodyEvent["type"], string> = {
  package_created: "Scan package created",
  file_added: "File added to package",
  licence_requested: "Licence requested",
  licence_approved: "Licence approved",
  licence_denied: "Licence denied",
  licence_revoked: "Licence revoked",
  file_downloaded: "Files released under licence",
  talent_downloaded: "Accessed by performer",
  compliance_event: "Ledger entry",
};

const EVENT_ICON: Record<CustodyEvent["type"], React.ReactNode> = {
  package_created: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
  file_added: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  ),
  licence_requested: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  ),
  licence_approved: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
  licence_denied: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ),
  licence_revoked: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
  ),
  file_downloaded: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="8 17 12 21 16 17" />
      <line x1="12" y1="12" x2="12" y2="21" />
      <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.36" />
    </svg>
  ),
  talent_downloaded: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="8 17 12 21 16 17" />
      <line x1="12" y1="12" x2="12" y2="21" />
      <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.36" />
    </svg>
  ),
  compliance_event: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  ),
};

/** Human names for the hash-chained compliance-ledger event types. */
const LEDGER_LABEL: Record<string, string> = {
  "download.initiated": "Download initiated",
  "custody.licensee_verified": "Dual custody — licensee 2FA verified",
  "custody.talent_verified": "Dual custody — performer 2FA verified",
  "consent.granted": "Consent granted",
  "consent.dub_language_granted": "Dub-language consent granted",
  "consent.counter_proposed": "Counter-terms proposed",
  "consent.revoked": "Consent withdrawn",
  "licence.denied": "Licence denied",
  "licence.revoked": "Licence revoked",
  "biometric.isolation_attested": "Biometric-isolation attestation",
  "security.custody_attested": "Custody controls attested",
  "replica.scrub_attested": "Scrub and deletion attested",
  "transfer.requested": "Third-party transfer requested",
  "transfer.approved": "Third-party transfer approved",
  "transfer.denied": "Third-party transfer denied",
  "business_reason.recorded": "Business reason recorded",
  "training.notice_filed": "AI-training notice filed",
  "strike.declared": "Strike declared",
  "strike.lifted": "Strike lifted",
  "use.blocked": "Use blocked",
  "use.blocked_by_strike": "Use blocked by strike",
  "use.metered": "Metered use recorded",
  "package.attached": "Scan package attached to licence",
};

function eventLabel(e: CustodyEvent): string {
  if (e.type !== "compliance_event") return EVENT_LABEL[e.type];
  const t = e.complianceEventType;
  if (!t) return "Ledger entry";
  return LEDGER_LABEL[t] ?? t.replace(/[._]/g, " ");
}

// ── Chain rail ─────────────────────────────────────────────────────────────────

const RAIL_GUTTER = 26; // px — width of the rail column
const NODE = 9;

/**
 * The rail node. A filled square means the entry is sealed into the hash chain;
 * a hollow circle means it is derived from platform records that are logged but
 * not themselves chained. The distinction is the honest one to draw — a reader
 * should be able to tell at a glance which lines carry cryptographic weight.
 */
function RailNode({ tone, sealed }: { tone: Tone; sealed: boolean }) {
  const colour = TONE_COLOR[tone];
  return (
    <span
      aria-hidden
      style={{
        position: "absolute",
        left: -(NODE / 2) - 0.5,
        top: 15,
        width: NODE,
        height: NODE,
        borderRadius: sealed ? 1 : "50%",
        background: sealed ? colour : DOC.paper,
        border: `1.5px solid ${colour}`,
        boxSizing: "border-box",
      }}
    />
  );
}

function EventRow({ event, index }: { event: CustodyEvent; index: number }) {
  const sealed = isLedgerEvent(event);
  const tone = eventTone(event.type, event.complianceEventType);
  const colour = TONE_COLOR[tone];

  return (
    <div className="doc-keep flex" style={{ borderBottom: `1px solid ${DOC.rule}` }}>
      {/* Ordinal — the reader's citation handle for a line in the record. */}
      <div
        className="shrink-0 text-right pr-2 pt-3.5"
        style={{ width: 30, fontFamily: DOC.mono, fontSize: 9, color: DOC.faint }}
      >
        {String(index + 1).padStart(3, "0")}
      </div>

      {/* The rail: a continuous hairline with this event's node sitting on it. */}
      <div
        className="shrink-0 relative"
        style={{ width: RAIL_GUTTER, borderLeft: `1px solid ${DOC.rule}` }}
      >
        <RailNode tone={tone} sealed={sealed} />
      </div>

      <div className="flex-1 min-w-0 py-3">
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <span className="flex items-center gap-2 min-w-0">
            <span style={{ color: colour, display: "inline-flex" }}>{EVENT_ICON[event.type]}</span>
            <span
              className="uppercase"
              style={{
                fontFamily: DOC.sans,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.11em",
                color: colour,
              }}
            >
              {eventLabel(event)}
            </span>
            {event.clauseRef && (
              <span
                style={{
                  fontFamily: DOC.mono,
                  fontSize: 9,
                  color: DOC.muted,
                  border: `1px solid ${DOC.rule}`,
                  borderRadius: 3,
                  padding: "1px 4px",
                }}
              >
                §{event.clauseRef}
              </span>
            )}
          </span>
          <span
            className="shrink-0"
            style={{ fontFamily: DOC.mono, fontSize: 9.5, color: DOC.muted }}
          >
            {isoUtc(event.at)}
          </span>
        </div>

        {/* The chain link. This is what separates the record from an activity feed. */}
        {sealed && (
          <p
            style={{
              fontFamily: DOC.mono,
              fontSize: 9,
              color: DOC.faint,
              margin: "5px 0 0",
              letterSpacing: "0.02em",
            }}
          >
            <span style={{ color: DOC.muted }}>#{event.seq}</span>{" "}
            <span style={{ color: colour }}>{shortHash(event.hash)}</span>
            <span style={{ padding: "0 4px" }}>◄</span>
            {shortHash(event.prevHash)}
          </p>
        )}

        <div
          style={{ fontFamily: DOC.sans, fontSize: 11.5, color: DOC.text, marginTop: 5, lineHeight: 1.6 }}
        >
          <EventFields event={event} />
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <p style={{ margin: 0 }}>
      <span style={{ color: DOC.muted }}>{label}: </span>
      <span style={{ color: DOC.ink, fontWeight: 500, fontFamily: mono ? DOC.mono : undefined, fontSize: mono ? 10.5 : undefined }}>
        {value}
      </span>
    </p>
  );
}

function EventFields({ event }: { event: CustodyEvent }) {
  switch (event.type) {
    case "package_created":
      return <Field label="Uploaded by" value={event.actor ?? "—"} />;

    case "file_added":
      return (
        <>
          <Field label="Filename" value={event.filename ?? "—"} mono />
          {event.sizeBytes != null && <Field label="Size" value={fmtBytes(event.sizeBytes)} />}
        </>
      );

    case "licence_requested":
      return (
        <>
          <Field label="Requesting organisation" value={event.productionCompany ?? "—"} />
          <Field label="Licensee contact" value={event.licensee ?? "—"} />
          <Field label="Project" value={event.projectName ?? "—"} />
          {event.intendedUse && <Field label="Intended use" value={<em>{event.intendedUse}</em>} />}
          {event.validFrom && event.validTo && (
            <Field label="Licence period" value={`${fmtDate(event.validFrom)} — ${fmtDate(event.validTo)}`} />
          )}
        </>
      );

    case "licence_approved":
      return (
        <>
          <Field label="Project" value={`${event.projectName ?? "—"} — ${event.productionCompany ?? "—"}`} />
          <Field label="Approved by" value={event.approvedBy ?? "—"} />
        </>
      );

    case "licence_denied":
      return (
        <>
          <Field label="Project" value={`${event.projectName ?? "—"} — ${event.productionCompany ?? "—"}`} />
          {event.deniedReason && <Field label="Reason" value={<em>{event.deniedReason}</em>} />}
        </>
      );

    case "licence_revoked":
      return <Field label="Project" value={`${event.projectName ?? "—"} — ${event.productionCompany ?? "—"}`} />;

    case "file_downloaded":
      return (
        <>
          <Field label="Licensee" value={event.licensee ?? "—"} />
          <Field label="Project" value={`${event.projectName ?? "—"} — ${event.productionCompany ?? "—"}`} />
          {event.filename && <Field label="File" value={event.filename} mono />}
          {event.bytesTransferred != null && <Field label="Transferred" value={fmtBytes(event.bytesTransferred)} />}
          {event.ip && <Field label="Source IP" value={event.ip} mono />}
          {event.completedAt && <Field label="Completed" value={isoUtc(event.completedAt)} mono />}
        </>
      );

    case "talent_downloaded":
      return (
        <>
          <Field label="Accessed by" value={event.actor ?? "—"} />
          {event.filename && <Field label="File" value={event.filename} mono />}
          {event.bytesTransferred != null && <Field label="Size" value={fmtBytes(event.bytesTransferred)} />}
          {event.ip && <Field label="Source IP" value={event.ip} mono />}
        </>
      );

    case "compliance_event":
      return (
        <>
          {event.projectName && (
            <Field
              label="Project"
              value={`${event.projectName}${event.productionCompany ? ` — ${event.productionCompany}` : ""}`}
            />
          )}
          {event.actor && <Field label="Actor" value={event.actor} />}
          {event.ip && <Field label="Source IP" value={event.ip} mono />}
        </>
      );

    default:
      return null;
  }
}

function DayRule({ ts }: { ts: number }) {
  return (
    <div className="doc-keep flex items-center gap-3 pt-5 pb-1.5">
      <div style={{ width: 30 }} />
      <p
        className="uppercase shrink-0"
        style={{
          fontFamily: DOC.mono,
          fontSize: 9,
          fontWeight: 500,
          letterSpacing: "0.16em",
          color: DOC.muted,
          margin: 0,
        }}
      >
        {docDate(ts)}
      </p>
      <div className="flex-1 h-px" style={{ background: DOC.rule }} />
    </div>
  );
}

// ── Parties ────────────────────────────────────────────────────────────────────

interface Party {
  name: string;
  role: string;
  first: number;
  last: number;
  events: number;
}

/**
 * Everyone who appears anywhere in the record, with when they first and last
 * touched it. Derived from the events themselves so it can never disagree with
 * the log below it.
 */
function deriveParties(events: CustodyEvent[], ownerEmail: string): Party[] {
  const map = new Map<string, Party>();

  const touch = (name: string | null | undefined, role: string, at: number) => {
    if (!name) return;
    const key = `${role}::${name}`;
    const existing = map.get(key);
    if (existing) {
      existing.first = Math.min(existing.first, at);
      existing.last = Math.max(existing.last, at);
      existing.events += 1;
      return;
    }
    map.set(key, { name, role, first: at, last: at, events: 1 });
  };

  for (const e of events) {
    switch (e.type) {
      case "package_created":
      case "talent_downloaded":
        touch(e.actor ?? ownerEmail, "Performer", e.at);
        break;
      case "file_added":
        touch(ownerEmail, "Performer", e.at);
        break;
      case "licence_requested":
        touch(e.productionCompany, "Production company", e.at);
        touch(e.licensee, "Licensee", e.at);
        break;
      case "licence_approved":
        touch(e.productionCompany, "Production company", e.at);
        touch(e.approvedBy, "Approver", e.at);
        break;
      case "licence_denied":
      case "licence_revoked":
        touch(e.productionCompany, "Production company", e.at);
        break;
      case "file_downloaded":
        touch(e.productionCompany, "Production company", e.at);
        touch(e.licensee, "Licensee", e.at);
        break;
      case "compliance_event":
        touch(e.productionCompany, "Production company", e.at);
        touch(e.actor, "Actor on ledger", e.at);
        break;
    }
  }

  return [...map.values()].sort((a, b) => a.first - b.first);
}

function PartiesTable({ parties }: { parties: Party[] }) {
  if (parties.length === 0) return null;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: DOC.sans, fontSize: 11 }}>
      <thead>
        <tr>
          {["Party", "Capacity", "First appearance", "Last appearance", "Entries"].map((h, i) => (
            <th
              key={h}
              className="uppercase"
              style={{
                textAlign: i >= 4 ? "right" : "left",
                fontSize: 8.5,
                fontWeight: 700,
                letterSpacing: "0.12em",
                color: DOC.muted,
                padding: "5px 8px 5px 0",
                borderBottom: `1px solid ${DOC.rule}`,
              }}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {parties.map((p) => (
          <tr key={`${p.role}::${p.name}`} className="doc-keep">
            <td style={{ padding: "6px 8px 6px 0", borderBottom: `1px solid ${DOC.rule}`, color: DOC.ink, fontWeight: 500 }}>
              {p.name}
            </td>
            <td style={{ padding: "6px 8px 6px 0", borderBottom: `1px solid ${DOC.rule}`, color: DOC.muted }}>
              {p.role}
            </td>
            <td style={{ padding: "6px 8px 6px 0", borderBottom: `1px solid ${DOC.rule}`, fontFamily: DOC.mono, fontSize: 10, color: DOC.text }}>
              {fmtDate(p.first)}
            </td>
            <td style={{ padding: "6px 8px 6px 0", borderBottom: `1px solid ${DOC.rule}`, fontFamily: DOC.mono, fontSize: 10, color: DOC.text }}>
              {fmtDate(p.last)}
            </td>
            <td style={{ padding: "6px 0", borderBottom: `1px solid ${DOC.rule}`, fontFamily: DOC.mono, fontSize: 10, color: DOC.text, textAlign: "right" }}>
              {p.events}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function CustodyClient({ packageId }: { packageId: string }) {
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/vault/packages/${packageId}/activity`)
      .then((r) => {
        if (r.status === 401) {
          window.location.href = `/api/auth/refresh?next=/vault/packages/${packageId}/chain-of-custody`;
          return null;
        }
        if (!r.ok) throw new Error(`Failed to load activity (${r.status})`);
        return r.json() as Promise<ActivityResponse>;
      })
      .then((d) => {
        if (d) setData(d);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Error"))
      .finally(() => setLoading(false));
  }, [packageId]);

  const parties = useMemo(
    () => (data ? deriveParties(data.events, data.package.talentEmail) : []),
    [data],
  );

  // Which rows open a new day. Precomputed rather than tracked with a mutable
  // cursor during render, so a re-render can't shift the day rules.
  const dayBreaks = useMemo(() => {
    if (!data) return [] as boolean[];
    let prev = "";
    return data.events.map((e) => {
      const day = docDate(e.at);
      const isNew = day !== prev;
      prev = day;
      return isNew;
    });
  }, [data]);

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-64">
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>
          Loading chain of custody…
        </p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8">
        <p className="text-xs" style={{ color: "var(--color-danger)" }}>
          {error ?? "Not found"}
        </p>
      </div>
    );
  }

  const ref = buildDocRef("IMG", data.generatedAt, data.package.id);
  const verifyUrl = data.verifyUrl;
  const sealedCount = data.events.filter(isLedgerEvent).length;
  const period =
    data.events.length > 0
      ? `${fmtDate(data.events[0].at)} — ${fmtDate(data.events[data.events.length - 1].at)}`
      : "—";

  const chainSummary = `${data.chains.length} chain${data.chains.length === 1 ? "" : "s"} · ${sealedCount} sealed ${
    sealedCount === 1 ? "entry" : "entries"
  } · ${data.chainsOk ? "all verified" : "verification failed"}`;

  return (
    <div className="p-8 max-w-3xl mx-auto">
      {/* ── Screen nav ── */}
      <div className="no-print mb-6 flex items-center justify-between">
        <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-xs" style={{ color: "var(--color-muted)" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to vault
        </Link>
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium border transition"
          style={{ borderColor: "var(--color-border)", color: "var(--color-ink)", borderRadius: "var(--radius)" }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 6 2 18 2 18 9" />
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
            <rect x="6" y="14" width="12" height="8" />
          </svg>
          Print / Export PDF
        </button>
      </div>

      {/* ── Screen-only human framing. The document below is the formal,
          print-ready evidence; the Inlay never enters the PDF. ── */}
      {data.events.length > 0 && (
        <div className="no-print mb-6">
          <Inlay
            eyebrow="Chain of custody"
            gate
            footnote={`${data.events.length} event${data.events.length !== 1 ? "s" : ""} · ${sealedCount} sealed into the ledger · UTC`}
          >
            Every touch on this likeness is <em>on the permanent record.</em>
          </Inlay>
        </div>
      )}

      {/* ── The document ── */}
      <div
        className="doc-body border"
        style={{ borderColor: DOC.rule, background: DOC.paper, fontFamily: DOC.sans }}
      >
        {/* ── Cover ── */}
        <div className="doc-break-after px-10 pt-10 pb-8">
          <div className="flex items-start justify-between gap-6 mb-8">
            <Wordmark variant="lock" style={{ fontSize: 11 }} />
            <div className="text-right" style={{ fontFamily: DOC.mono, fontSize: 9.5, color: DOC.muted }}>
              <p style={{ margin: 0 }}>{ref}</p>
              <p style={{ margin: 0 }}>{isoUtc(data.generatedAt)}</p>
            </div>
          </div>

          <p
            className="uppercase"
            style={{
              fontFamily: DOC.sans,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.28em",
              color: DOC.brick,
              margin: "0 0 8px",
            }}
          >
            Chain of custody record
          </p>
          <h1
            style={{
              fontFamily: DOC.serif,
              fontSize: 30,
              fontWeight: 600,
              letterSpacing: "-0.015em",
              lineHeight: 1.15,
              color: DOC.ink,
              margin: "0 0 6px",
            }}
          >
            {data.package.talentName ?? data.package.talentEmail}
          </h1>
          <p style={{ fontSize: 13, color: DOC.text, margin: "0 0 24px", maxWidth: "46ch", lineHeight: 1.6 }}>
            A complete account of every recorded action taken on this biometric scan
            package, from capture to the present, with the ledger position of each
            sealed entry.
          </p>

          <DocMeta
            items={[
              { label: "Scan package", value: data.package.name },
              { label: "Vault code", value: data.package.chainCode, mono: true },
              { label: "Performer", value: data.package.talentEmail, mono: true },
              { label: "Period covered", value: period },
              ...(data.package.captureDate
                ? [{ label: "Capture date", value: fmtDate(data.package.captureDate) }]
                : []),
              ...(data.package.studioName
                ? [{ label: "Studio / facility", value: data.package.studioName }]
                : []),
              { label: "Entries in record", value: String(data.events.length) },
              { label: "Files under custody", value: String(data.files.length) },
              { label: "Package ID", value: data.package.id, mono: true },
              { label: "Document ref", value: ref, mono: true },
            ]}
          />

          <div className="mt-6">
            <TamperSeal
              sealHash={data.recordHash}
              verifyUrl={verifyUrl}
              summary={chainSummary}
              intact={data.chainsOk}
              breakDetail={data.chainBreak}
            />
          </div>

          {parties.length > 0 && (
            <div className="mt-8">
              <DocRule label="Parties on the record" />
              <PartiesTable parties={parties} />
            </div>
          )}
        </div>

        {/* ── Event log ── */}
        <div className="px-10 pt-8 pb-6" style={{ borderTop: `1px solid ${DOC.rule}` }}>
          <DocRule label={`Event log — chronological (${data.events.length})`} />

          <p style={{ fontSize: 11, color: DOC.muted, margin: "0 0 14px", lineHeight: 1.6, maxWidth: "72ch" }}>
            A <span style={{ display: "inline-block", width: 8, height: 8, background: DOC.ink, borderRadius: 1, marginRight: 3 }} />
            filled marker denotes an entry sealed into the append-only ledger — it carries a
            sequence number and the hash of the entry before it. A{" "}
            <span
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: "50%",
                border: `1.5px solid ${DOC.ink}`,
                marginRight: 3,
                boxSizing: "border-box",
              }}
            />
            hollow marker denotes an action drawn from the platform&apos;s operational
            records, which are logged but not themselves chained.
          </p>

          {data.events.length === 0 ? (
            <p style={{ fontSize: 12, fontStyle: "italic", color: DOC.muted }}>No events recorded.</p>
          ) : (
            <div>
              {data.events.map((event, i) => (
                <div key={`${event.type}-${i}`}>
                  {dayBreaks[i] && <DayRule ts={event.at} />}
                  <EventRow event={event} index={i} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── File manifest ── */}
        {data.files.length > 0 && (
          <div className="px-10 pt-6 pb-6">
            <DocRule label={`Files under custody (${data.files.length})`} />
            <p style={{ fontSize: 11, color: DOC.muted, margin: "0 0 12px", lineHeight: 1.6, maxWidth: "72ch" }}>
              SHA-256 digests of the stored objects. A file recovered elsewhere can be
              tested against these digests to establish whether it came from this package.
            </p>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["File", "Size", "SHA-256"].map((h, i) => (
                    <th
                      key={h}
                      className="uppercase"
                      style={{
                        textAlign: i === 1 ? "right" : "left",
                        fontSize: 8.5,
                        fontWeight: 700,
                        letterSpacing: "0.12em",
                        color: DOC.muted,
                        padding: "5px 10px 5px 0",
                        borderBottom: `1px solid ${DOC.rule}`,
                        width: i === 2 ? "42%" : undefined,
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.files.map((f, i) => (
                  <tr key={`${f.filename}-${i}`} className="doc-keep">
                    <td
                      style={{
                        padding: "7px 10px 7px 0",
                        borderBottom: `1px solid ${DOC.rule}`,
                        fontFamily: DOC.mono,
                        fontSize: 10.5,
                        color: DOC.ink,
                        wordBreak: "break-all",
                      }}
                    >
                      {f.filename}
                    </td>
                    <td
                      style={{
                        padding: "7px 10px 7px 0",
                        borderBottom: `1px solid ${DOC.rule}`,
                        fontFamily: DOC.mono,
                        fontSize: 10.5,
                        color: DOC.text,
                        textAlign: "right",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {fmtBytes(f.sizeBytes)}
                    </td>
                    <td style={{ padding: "7px 0", borderBottom: `1px solid ${DOC.rule}` }}>
                      {f.sha256 ? (
                        <HashQuads hash={f.sha256} size={10} color={DOC.text} />
                      ) : (
                        <span style={{ fontFamily: DOC.mono, fontSize: 10, color: DOC.faint }}>
                          not yet computed
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Chain index ── */}
        {data.chains.length > 0 && (
          <div className="px-10 pt-6 pb-6">
            <DocRule label="Ledger chains sealed into this record" />
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {data.chains.map((c) => (
                  <tr key={c.chainKey} className="doc-keep">
                    <td
                      style={{
                        padding: "7px 10px 7px 0",
                        borderBottom: `1px solid ${DOC.rule}`,
                        fontFamily: DOC.mono,
                        fontSize: 10.5,
                        color: DOC.ink,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {c.chainKey}
                    </td>
                    <td
                      style={{
                        padding: "7px 10px 7px 0",
                        borderBottom: `1px solid ${DOC.rule}`,
                        fontFamily: DOC.sans,
                        fontSize: 10.5,
                        color: DOC.muted,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {c.eventCount} {c.eventCount === 1 ? "entry" : "entries"}
                    </td>
                    <td style={{ padding: "7px 10px 7px 0", borderBottom: `1px solid ${DOC.rule}` }}>
                      <HashQuads hash={c.tipHash} size={10} color={DOC.text} />
                    </td>
                    <td
                      className="uppercase"
                      style={{
                        padding: "7px 0",
                        borderBottom: `1px solid ${DOC.rule}`,
                        fontFamily: DOC.sans,
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: "0.1em",
                        color: c.ok ? DOC.olive : DOC.brick,
                        textAlign: "right",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {c.ok ? "Verified" : `Broken @ ${c.brokenAtSeq ?? "?"}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Legal notice ── */}
        <div
          className="doc-keep px-10 py-7"
          style={{ borderTop: `1px solid ${DOC.rule}`, background: DOC.inset }}
        >
          <p
            className="uppercase"
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.2em",
              color: DOC.ink,
              margin: "0 0 8px",
            }}
          >
            Legal notice
          </p>
          <p style={{ fontSize: 10.5, lineHeight: 1.7, color: DOC.text, margin: 0 }}>
            This record was produced from the ImageVault platform at {isoUtc(data.generatedAt)}.
            All timestamps are Coordinated Universal Time. Entries marked as sealed are held in
            an append-only ledger in which each entry carries the SHA-256 hash of the entry
            before it, so that any subsequent alteration, reordering, or removal is detectable
            by recomputation; the sealed hash on the cover of this document, and the verification
            address printed alongside it, allow that recomputation to be carried out
            independently. Access events are recorded at the point of authentication and at the
            initiation of file transfer. Scan data is held in encrypted object storage under
            access controls including dual-custody two-factor authorisation and time-limited
            download tokens; the platform is the data processor and is technically capable of
            accessing stored content, and this record does not assert otherwise. This document
            constitutes evidence of the chain of custody for the biometric scan package
            identified above and may be produced in legal proceedings. Unauthorised use,
            reproduction, or modification of biometric scan data without a valid and unexpired
            licence is a breach of contract and may constitute an offence under applicable data
            protection legislation including the UK GDPR and the Data Protection Act 2018.
          </p>

          <div
            className="mt-5 pt-4 flex items-center justify-between gap-4 flex-wrap"
            style={{ borderTop: `1px solid ${DOC.rule}` }}
          >
            <Wordmark variant="lock" style={{ fontSize: 9 }} />
            <p style={{ fontFamily: DOC.mono, fontSize: 9.5, color: DOC.muted, margin: 0 }}>{ref}</p>
          </div>

          <div className="mt-4">
            <DocEnd />
          </div>
        </div>
      </div>

      {/* Running footer — Chrome repeats a fixed element on every printed page,
          so the document reference travels with any page separated from the set. */}
      <div className="doc-print-footer" aria-hidden>
        <span style={{ fontFamily: DOC.mono, fontSize: 8, color: DOC.muted }}>
          {ref} · {quads(data.recordHash.slice(0, 16))}… · imagevault.ai/verify
        </span>
      </div>

      <style>{`
        ${DOC_PRINT_CSS}
        .doc-print-footer { display: none; }
        @media print {
          .doc-body { padding-bottom: 10mm; }
          .doc-print-footer {
            display: block;
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            text-align: center;
            padding-top: 4px;
            border-top: 1px solid ${DOC.rule};
            background: #fff;
          }
        }
      `}</style>
    </div>
  );
}

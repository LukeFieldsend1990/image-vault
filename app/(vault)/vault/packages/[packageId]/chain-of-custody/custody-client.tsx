"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import type { ActivityResponse, CustodyEvent } from "@/app/api/vault/packages/[packageId]/activity/route";

// ── Helpers ────────────────────────────────────────────────────────────────────

function isoUtc(ts: number): string {
  return new Date(ts * 1000).toISOString().replace("T", " ").replace(".000Z", " UTC");
}

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ── Event row rendering ────────────────────────────────────────────────────────

const EVENT_CONFIG: Record<
  CustodyEvent["type"],
  { label: string; colour: string; icon: React.ReactNode }
> = {
  package_created: {
    label: "SCAN PACKAGE CREATED",
    colour: "#166534",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
  },
  file_added: {
    label: "FILE ADDED TO PACKAGE",
    colour: "#374151",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    ),
  },
  licence_requested: {
    label: "LICENCE REQUESTED",
    colour: "#92400e",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    ),
  },
  licence_approved: {
    label: "LICENCE APPROVED",
    colour: "#166534",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ),
  },
  licence_denied: {
    label: "LICENCE DENIED",
    colour: "#991b1b",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    ),
  },
  licence_revoked: {
    label: "LICENCE REVOKED",
    colour: "#c0392b",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
      </svg>
    ),
  },
  file_downloaded: {
    label: "FILES DOWNLOADED (LICENSED)",
    colour: "#1d4ed8",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="8 17 12 21 16 17" />
        <line x1="12" y1="12" x2="12" y2="21" />
        <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.36" />
      </svg>
    ),
  },
  talent_downloaded: {
    label: "ACCESSED BY TALENT",
    colour: "#374151",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="8 17 12 21 16 17" />
        <line x1="12" y1="12" x2="12" y2="21" />
        <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.36" />
      </svg>
    ),
  },
};

function EventRow({ event, index }: { event: CustodyEvent; index: number }) {
  const cfg = EVENT_CONFIG[event.type];

  return (
    <div className="event-row flex gap-4 py-4 border-b last:border-b-0" style={{ borderColor: "#e5e5e5" }}>
      {/* Index + icon */}
      <div className="flex flex-col items-center gap-1 shrink-0 w-8">
        <span className="text-[9px] font-mono tabular-nums" style={{ color: "#aaaaaa" }}>
          {String(index + 1).padStart(2, "0")}
        </span>
        <span style={{ color: cfg.colour }}>{cfg.icon}</span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Event label + timestamp */}
        <div className="flex items-baseline justify-between gap-4 flex-wrap mb-1">
          <span className="text-[10px] font-bold tracking-[0.12em]" style={{ color: cfg.colour }}>
            {cfg.label}
          </span>
          <span className="text-[10px] font-mono tabular-nums shrink-0" style={{ color: "#777777" }}>
            {isoUtc(event.at)}
          </span>
        </div>

        {/* Event-specific fields */}
        <div className="text-xs space-y-0.5" style={{ color: "#333333" }}>
          {event.type === "package_created" && (
            <p>Uploaded by: <span className="font-medium">{event.actor}</span></p>
          )}

          {event.type === "file_added" && (
            <>
              <p>Filename: <span className="font-mono font-medium">{event.filename}</span></p>
              {event.sizeBytes != null && (
                <p>Size: <span className="font-medium">{fmtBytes(event.sizeBytes)}</span></p>
              )}
            </>
          )}

          {event.type === "licence_requested" && (
            <>
              <p>Requesting organisation: <span className="font-medium">{event.productionCompany}</span></p>
              <p>Licensee contact: <span className="font-medium">{event.licensee}</span></p>
              <p>Project: <span className="font-medium">{event.projectName}</span></p>
              {event.intendedUse && (
                <p className="leading-relaxed">Intended use: <span className="italic">{event.intendedUse}</span></p>
              )}
              {event.validFrom && event.validTo && (
                <p>Licence period: <span className="font-medium">{fmtDate(event.validFrom)} — {fmtDate(event.validTo)}</span></p>
              )}
            </>
          )}

          {event.type === "licence_approved" && (
            <>
              <p>Project: <span className="font-medium">{event.projectName}</span> — {event.productionCompany}</p>
              <p>Approved by: <span className="font-medium">{event.approvedBy}</span></p>
            </>
          )}

          {event.type === "licence_denied" && (
            <>
              <p>Project: <span className="font-medium">{event.projectName}</span> — {event.productionCompany}</p>
              {event.deniedReason && (
                <p>Reason: <span className="italic">{event.deniedReason}</span></p>
              )}
            </>
          )}

          {event.type === "licence_revoked" && (
            <p>Project: <span className="font-medium">{event.projectName}</span> — {event.productionCompany}</p>
          )}

          {event.type === "file_downloaded" && (
            <>
              <p>Licensee: <span className="font-medium">{event.licensee}</span></p>
              <p>Project: <span className="font-medium">{event.projectName}</span> — {event.productionCompany}</p>
              {event.filename && (
                <p>File: <span className="font-mono font-medium">{event.filename}</span></p>
              )}
              {event.bytesTransferred != null && (
                <p>Transferred: <span className="font-medium">{fmtBytes(event.bytesTransferred)}</span></p>
              )}
              {event.ip && (
                <p>Source IP: <span className="font-mono font-medium">{event.ip}</span></p>
              )}
              {event.completedAt && (
                <p>Completed: <span className="font-mono">{isoUtc(event.completedAt)}</span></p>
              )}
            </>
          )}

          {event.type === "talent_downloaded" && (
            <>
              <p>Accessed by: <span className="font-medium">{event.actor}</span></p>
              {event.filename && (
                <p>File: <span className="font-mono font-medium">{event.filename}</span></p>
              )}
              {event.bytesTransferred != null && (
                <p>Size: <span className="font-medium">{fmtBytes(event.bytesTransferred)}</span></p>
              )}
              {event.ip && (
                <p>Source IP: <span className="font-mono font-medium">{event.ip}</span></p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function CustodyClient({ packageId }: { packageId: string }) {
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

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
      .then((d) => { if (d) setData(d); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Error"))
      .finally(() => setLoading(false));
  }, [packageId]);

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-64">
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>Loading chain of custody…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8">
        <p className="text-xs" style={{ color: "var(--color-danger)" }}>{error ?? "Not found"}</p>
      </div>
    );
  }

  const docRef = `IMG-${new Date(data.generatedAt * 1000).toISOString().slice(0, 10).replace(/-/g, "")}-${data.package.id.slice(0, 6).toUpperCase()}`;

  return (
    <div className="p-8 max-w-3xl mx-auto">
      {/* ── Screen nav ── */}
      <div className="no-print mb-6 flex items-center justify-between">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-xs"
          style={{ color: "var(--color-muted)" }}
        >
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

      {/* ── Document ── */}
      <div
        ref={printRef}
        className="document-body border"
        style={{ borderColor: "#d1d5db", background: "#ffffff", fontFamily: "'Georgia', 'Times New Roman', serif" }}
      >
        {/* Header */}
        <div className="px-10 pt-10 pb-6 border-b" style={{ borderColor: "#d1d5db" }}>
          <div className="flex items-start justify-between gap-4 mb-6">
            <div>
              <p className="text-[9px] tracking-[0.25em] uppercase font-bold mb-1" style={{ color: "#888888", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
                United Agents · Image Vault
              </p>
              <h1 className="text-xl font-bold tracking-tight" style={{ color: "#000000" }}>
                Chain of Custody Record
              </h1>
            </div>
            <div className="text-right text-[10px] font-mono" style={{ color: "#555555" }}>
              <p>Document ref: {docRef}</p>
              <p>Generated: {isoUtc(data.generatedAt)}</p>
            </div>
          </div>

          {/* Package metadata */}
          <div
            className="rounded-sm p-4 text-xs grid grid-cols-2 gap-x-6 gap-y-1.5"
            style={{ background: "#f7f7f7", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
          >
            <div>
              <span className="uppercase tracking-wide text-[9px] font-bold" style={{ color: "#888888" }}>Scan Package</span>
              <p className="font-semibold mt-0.5" style={{ color: "#111111" }}>{data.package.name}</p>
            </div>
            <div>
              <span className="uppercase tracking-wide text-[9px] font-bold" style={{ color: "#888888" }}>Talent</span>
              <p className="font-mono mt-0.5" style={{ color: "#111111" }}>{data.package.talentEmail}</p>
            </div>
            {data.package.captureDate && (
              <div>
                <span className="uppercase tracking-wide text-[9px] font-bold" style={{ color: "#888888" }}>Capture Date</span>
                <p className="mt-0.5" style={{ color: "#111111" }}>{fmtDate(data.package.captureDate)}</p>
              </div>
            )}
            {data.package.studioName && (
              <div>
                <span className="uppercase tracking-wide text-[9px] font-bold" style={{ color: "#888888" }}>Studio / Facility</span>
                <p className="mt-0.5" style={{ color: "#111111" }}>{data.package.studioName}</p>
              </div>
            )}
            <div>
              <span className="uppercase tracking-wide text-[9px] font-bold" style={{ color: "#888888" }}>Package ID</span>
              <p className="font-mono mt-0.5 text-[10px]" style={{ color: "#555555" }}>{data.package.id}</p>
            </div>
            <div>
              <span className="uppercase tracking-wide text-[9px] font-bold" style={{ color: "#888888" }}>Total Events</span>
              <p className="mt-0.5" style={{ color: "#111111" }}>{data.events.length}</p>
            </div>
          </div>
        </div>

        {/* Event log */}
        <div className="px-10 py-6">
          <div className="flex items-center gap-3 mb-4">
            <p className="text-[9px] tracking-[0.25em] uppercase font-bold" style={{ color: "#888888", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
              Event Log — Chronological
            </p>
            <div className="flex-1 h-px" style={{ background: "#e5e5e5" }} />
          </div>

          {data.events.length === 0 ? (
            <p className="text-sm italic" style={{ color: "#888888" }}>No events recorded.</p>
          ) : (
            <div>
              {data.events.map((event, i) => (
                <EventRow key={i} event={event} index={i} />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-10 py-6 border-t text-[10px] leading-relaxed"
          style={{ borderColor: "#d1d5db", color: "#777777", fontFamily: "ui-sans-serif, system-ui, sans-serif", background: "#f9f9f9" }}
        >
          <p className="font-semibold mb-1" style={{ color: "#333333" }}>Legal Notice</p>
          <p>
            This document was generated from the Image Vault platform&apos;s tamper-evident activity
            log at {isoUtc(data.generatedAt)}. All timestamps are Coordinated Universal Time (UTC).
            Access events are recorded at the point of authentication and file transfer initiation.
            This record constitutes evidence of the chain of custody for the biometric scan package
            identified above and may be produced in legal proceedings. Unauthorised use, reproduction,
            or modification of biometric scan data without a valid and unexpired licence is a violation
            of contract and may constitute an offence under applicable data protection legislation
            including UK GDPR and the Data Protection Act 2018.
          </p>
          <div className="mt-4 pt-3 border-t flex items-center justify-between" style={{ borderColor: "#e5e5e5" }}>
            <p className="font-semibold" style={{ color: "#333333" }}>Image Vault — Secure Biometric Asset Management</p>
            <p>Document ref: {docRef}</p>
          </div>
        </div>
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .document-body { border: none !important; }
          body { background: white !important; }
          aside, header, footer, nav { display: none !important; }
          main { overflow: visible !important; }
        }
        @page {
          margin: 1.5cm;
        }
      `}</style>
    </div>
  );
}

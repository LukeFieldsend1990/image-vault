"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Inlay from "@/app/components/inlay";
import { HashQuads } from "@/app/components/seal";
import { isoUtc } from "@/lib/documents/palette";
import type { LifetimeCustody, LifetimeLedgerEvent, LifetimeLicence } from "@/lib/compliance/lifetime";

const card = "rounded p-4";
const cardStyle = { border: "1px solid var(--color-border)", background: "var(--color-surface)" };
const eyebrow = "text-[10px] font-semibold tracking-widest uppercase";

const LIVE_STATUSES = new Set(["APPROVED", "SCRUB_PERIOD", "OVERDUE"]);

const SEVERITY_COLOUR: Record<LifetimeLedgerEvent["severity"], string> = {
  info: "var(--color-active)",
  warn: "var(--color-expiring)",
  critical: "var(--color-danger)",
};

function fmtDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

function statusTone(l: LifetimeLicence): string {
  if (l.revokedAt || l.status === "REVOKED" || l.status === "DENIED") return "var(--color-danger)";
  if (l.status === "APPROVED") return "var(--color-active)";
  if (l.status === "SCRUB_PERIOD" || l.status === "OVERDUE" || l.status === "EXPIRED") return "var(--color-expiring)";
  return "var(--color-muted)";
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5 p-4" style={{ background: "var(--color-bg)" }}>
      <span className={eyebrow} style={{ color: "var(--color-muted)" }}>{label}</span>
      <span
        style={{ fontFamily: "var(--font-mono)", fontSize: 24, lineHeight: 1.1, color: "var(--color-ink)", fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </span>
      {sub && <span className="text-[11px]" style={{ color: "var(--color-faint)" }}>{sub}</span>}
    </div>
  );
}

function EventLine({ e }: { e: LifetimeLedgerEvent }) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <span
        aria-hidden
        className="shrink-0"
        style={{ width: 7, height: 7, borderRadius: 1, background: SEVERITY_COLOUR[e.severity], marginTop: 6 }}
      />
      <span className="flex-1 min-w-0">
        <span className="text-xs" style={{ color: "var(--color-ink)" }}>{e.label}</span>
        {e.clauseRef && (
          <span className="text-[10px] font-mono ml-1.5" style={{ color: "var(--color-muted)" }}>§{e.clauseRef}</span>
        )}
      </span>
      <span className="text-[10px] font-mono shrink-0" style={{ color: "var(--color-muted)" }}>
        #{e.seq} · {fmtDate(e.createdAt)}
      </span>
    </div>
  );
}

function LicenceBlock({ l }: { l: LifetimeLicence }) {
  const tone = statusTone(l);
  return (
    <div className="rounded" style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)" }}>
      <div className="p-4" style={{ borderBottom: l.events.length ? "1px solid var(--color-border)" : undefined }}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={eyebrow}
                style={{ color: tone, border: `1px solid ${tone}`, borderRadius: 3, padding: "1px 6px" }}
              >
                {l.status.replace(/_/g, " ")}
              </span>
              {l.shortCode && (
                <span className="text-[11px] font-mono" style={{ color: "var(--color-muted)" }}>{l.shortCode}</span>
              )}
              {!l.chainOk && (
                <span className={eyebrow} style={{ color: "var(--color-danger)" }}>chain broken</span>
              )}
            </div>
            <p className="text-sm font-medium mt-1.5" style={{ color: "var(--color-ink)" }}>
              {l.licenseeEmail ?? "Licensee unknown"}
            </p>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
              {fmtDate(l.validFrom)} — {fmtDate(l.validTo)}
              {l.packageName ? ` · ${l.packageName}` : ""}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[11px] font-mono" style={{ color: "var(--color-muted)" }}>
              {l.releaseCount} release{l.releaseCount === 1 ? "" : "s"}
            </p>
            {l.liveGrantCount > 0 && (
              <p className="text-[11px] font-mono" style={{ color: "var(--color-expiring)" }}>
                {l.liveGrantCount} live grant{l.liveGrantCount === 1 ? "" : "s"}
              </p>
            )}
            {l.packageId && (
              <Link
                href={`/vault/packages/${l.packageId}/chain-of-custody`}
                className="text-[11px] font-medium"
                style={{ color: "var(--color-accent)" }}
              >
                Custody record →
              </Link>
            )}
          </div>
        </div>
      </div>

      {l.events.length > 0 && (
        <div className="px-4 py-2">
          {l.events.map((e) => <EventLine key={e.id} e={e} />)}
        </div>
      )}
    </div>
  );
}

// Productions start collapsed: a performer with a long history would otherwise
// open onto hundreds of ledger lines. The header carries enough — company,
// licence count, anything live or broken — to decide whether to open it.
function ProductionBlock({ p }: { p: LifetimeCustody["productions"][number] }) {
  const [open, setOpen] = useState(false);

  // Mirrors LIVE_LICENCE_STATUSES in lib/compliance/lifetime.ts so this count
  // agrees with the "In force" stat above. Duplicated rather than imported:
  // that module pulls the DB layer in, which has no business in the bundle.
  const liveCount = p.licences.filter((l) => l.revokedAt == null && LIVE_STATUSES.has(l.status)).length;
  const chainBroken = p.licences.some((l) => !l.chainOk);

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-baseline gap-3 text-left"
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
      >
        <span
          aria-hidden
          className="shrink-0 self-center"
          style={{
            color: "var(--color-muted)",
            transform: open ? "rotate(90deg)" : "none",
            transition: "transform 120ms ease",
            lineHeight: 0,
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 5 16 12 9 19" />
          </svg>
        </span>
        <span className="min-w-0">
          <span
            className="block"
            style={{ fontFamily: "var(--font-serif)", fontSize: 19, fontWeight: 600, color: "var(--color-ink)" }}
          >
            {p.projectName}
          </span>
          <span className="block text-xs" style={{ color: "var(--color-muted)" }}>{p.productionCompany}</span>
        </span>
        <span className="flex-1 h-px self-center" style={{ background: "var(--color-border)" }} />
        {chainBroken && (
          <span className={`${eyebrow} shrink-0`} style={{ color: "var(--color-danger)" }}>chain broken</span>
        )}
        {liveCount > 0 && (
          <span className="text-[11px] font-mono shrink-0" style={{ color: "var(--color-active)" }}>
            {liveCount} in force
          </span>
        )}
        <span className="text-[11px] font-mono shrink-0" style={{ color: "var(--color-muted)" }}>
          {p.licences.length} licence{p.licences.length === 1 ? "" : "s"}
        </span>
      </button>

      {open && (
        <div className="space-y-2.5 mt-2.5">
          {p.licences.map((l) => <LicenceBlock key={l.id} l={l} />)}
        </div>
      )}
    </section>
  );
}

export default function LifetimeCustodyClient({ talentId }: { talentId?: string }) {
  const [data, setData] = useState<LifetimeCustody | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const qs = talentId ? `?talentId=${encodeURIComponent(talentId)}` : "";
    fetch(`/api/vault/custody${qs}`)
      .then(async (r) => {
        if (r.status === 401) {
          window.location.href = `/api/auth/refresh?next=/vault/custody`;
          return null;
        }
        const d = (await r.json()) as LifetimeCustody & { error?: string };
        if (!r.ok) throw new Error(d.error ?? `Failed to load (${r.status})`);
        return d;
      })
      .then((d) => { if (d) setData(d); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Error"))
      .finally(() => setLoading(false));
  }, [talentId]);

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-64">
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>Loading custody history…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8 max-w-3xl">
        <p className="text-sm" style={{ color: "var(--color-danger)" }}>{error ?? "Not found"}</p>
      </div>
    );
  }

  const s = data.summary;
  const who = data.talentName ?? data.talentEmail ?? "this performer";

  return (
    <div className="p-8 max-w-4xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
          Chain of custody
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)", lineHeight: 1.65, maxWidth: "66ch" }}>
          Every production that has held {who}&rsquo;s likeness, every licence granted over it, and
          every entry sealed into the ledger — assembled across productions rather than one scan
          package at a time.
        </p>
      </div>

      {s.ledgerEntries > 0 && (
        <Inlay
          eyebrow="Chain of custody"
          gate
          footnote={`${s.ledgerEntries} sealed ${s.ledgerEntries === 1 ? "entry" : "entries"} · ${data.chains.length} chains · ${
            data.chainsOk ? "all verified" : "verification failed"
          }`}
        >
          {s.productions === 0 ? (
            <>No production has held this likeness <em>yet.</em></>
          ) : (
            <>
              {s.productions} production{s.productions === 1 ? "" : "s"} have held this likeness.{" "}
              <em>Every one is on the record.</em>
            </>
          )}
        </Inlay>
      )}

      <div
        className="grid gap-px"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          background: "var(--color-border)",
          border: "1px solid var(--color-border)",
          borderRadius: 6,
          overflow: "hidden",
        }}
      >
        <Stat label="Productions" value={String(s.productions)} sub={`${s.licences} licence${s.licences === 1 ? "" : "s"}`} />
        <Stat label="In force" value={String(s.activeLicences)} sub="live licences" />
        <Stat label="Ledger" value={String(s.ledgerEntries)} sub="sealed entries" />
        <Stat label="Releases" value={String(s.releases)} sub="files handed over" />
        <Stat
          label="Live grants"
          value={String(s.liveGrants)}
          sub={s.liveGrants > 0 ? "vendors with access now" : "none open"}
        />
      </div>

      {!data.chainsOk && (
        <div className={card} style={{ ...cardStyle, borderLeft: "3px solid var(--color-danger)", background: "var(--color-accent-tint)" }}>
          <p className={eyebrow} style={{ color: "var(--color-danger)", margin: 0 }}>Integrity failure</p>
          <p className="text-sm mt-1.5" style={{ color: "var(--color-ink)" }}>{data.chainBreak}</p>
        </div>
      )}

      {s.firstActivity && (
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>
          Record spans {fmtDate(s.firstActivity)} — {s.lastActivity ? fmtDate(s.lastActivity) : "present"}.
        </p>
      )}

      {data.platformEvents.length > 0 && (
        <section className={card} style={cardStyle}>
          <p className={eyebrow} style={{ color: "var(--color-muted)", margin: "0 0 4px" }}>Platform-level entries</p>
          <p className="text-xs mb-2" style={{ color: "var(--color-muted)" }}>
            Events recorded against the performer rather than any one licence — a change of data
            controller, for instance.
          </p>
          {data.platformEvents.map((e) => <EventLine key={e.id} e={e} />)}
        </section>
      )}

      {data.productions.length === 0 ? (
        <div className={card} style={cardStyle}>
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>
            No production has licensed this likeness yet. Once one does, its full custody history
            appears here.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {data.productions.map((p) => (
            <ProductionBlock key={`${p.productionCompany}::${p.projectName}`} p={p} />
          ))}
        </div>
      )}

      <div className={card} style={cardStyle}>
        <p className={eyebrow} style={{ color: "var(--color-muted)", margin: "0 0 6px" }}>Record hash</p>
        <HashQuads hash={data.recordHash} size={11} color="var(--color-text)" />
        <p className="text-[11px] mt-2" style={{ color: "var(--color-muted)", lineHeight: 1.6 }}>
          A single SHA-256 over every chain tip above, recomputed when this page loaded
          ({isoUtc(data.generatedAt)}). It changes whenever any entry does.
        </p>
      </div>
    </div>
  );
}

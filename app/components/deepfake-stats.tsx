"use client";

/**
 * Deepfake statistics report — the shared body rendered by all three surfaces
 * (union watcher, rep, admin). Every number arrives pre-computed from
 * lib/monitor/hit-stats.ts; nothing is derived here beyond bar heights, so the
 * three views can never quietly disagree about what "this month" or "growth"
 * means.
 *
 * Counts only, by construction: the payload carries no hit content, so no
 * amount of UI work here can leak a URL, caption or thumbnail into the union
 * view.
 */

import { useMemo, useState } from "react";

// ── Types (mirror lib/monitor/hit-stats.ts) ──────────────────────────────────

export interface GrowthReading {
  current: number;
  previous: number;
  pct: number | null;
  direction: "up" | "down" | "flat";
}

export interface MonthBucket {
  month: string;
  label: string;
  hits: number;
}

export interface BreakdownSlice {
  key: string;
  label: string;
  hits: number;
  share: number;
}

export interface MemberHitStats {
  talentId: string;
  name: string;
  total: number;
  open: number;
  confirmed: number;
  takedownRequested: number;
  resolved: number;
  dismissed: number;
  highRisk: number;
  thisMonth: number;
  prevMonthToDate: number;
  prevMonthFull: number;
  last30d: number;
  prev30d: number;
  latestAt: number | null;
}

export interface DeepfakeHitStats {
  generatedAt: number;
  cohort: { size: number; withHits: number; withOpenHits: number };
  lifetime: {
    total: number;
    open: number;
    confirmed: number;
    takedownRequested: number;
    resolved: number;
    dismissed: number;
    highRisk: number;
    firstDetectedAt: number | null;
    latestAt: number | null;
  };
  thisMonth: {
    month: string;
    label: string;
    hits: number;
    daysElapsed: number;
    perDay: number;
    projected: number;
  };
  growth: {
    monthOnMonth: GrowthReading;
    completedMonths: GrowthReading;
    rolling30d: GrowthReading;
  };
  months: MonthBucket[];
  byPlatform: BreakdownSlice[];
  byRisk: BreakdownSlice[];
  members: MemberHitStats[];
}

export interface StatsScope {
  kind: "union" | "roster" | "admin";
  label: string;
  /** "member" | "client" | "talent" — what one row of the breakdown is called. */
  memberNoun: string;
  unionId?: string | null;
  available?: { id: string; shortName: string }[];
  roster?: { total: number; onPlatform: number; coveragePct: number };
}

export interface DeepfakeStatsPayload {
  scope: StatsScope;
  stats: DeepfakeHitStats;
}

// ── Formatting ───────────────────────────────────────────────────────────────

const RISK_COLORS: Record<string, string> = {
  critical: "#7f1d1d",
  high: "#dc2626",
  medium: "#d97706",
  low: "#6b7280",
};

function fmtDate(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

/** Rising deepfake volume is bad news, so "up" is the accent, never green. */
function growthTone(g: GrowthReading): string {
  if (g.direction === "up") return "var(--color-accent)";
  if (g.direction === "down") return "#16a34a";
  return "var(--color-muted)";
}

function growthText(g: GrowthReading): string {
  if (g.pct === null) {
    // No baseline to divide by. Say what happened instead of inventing a rate.
    return g.current === 0 ? "no activity" : "first activity in this window";
  }
  const sign = g.pct > 0 ? "+" : "";
  return `${sign}${g.pct}%`;
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function Tile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: string;
}) {
  return (
    <div
      className="rounded p-4"
      style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
    >
      <p
        className="text-[10px] font-medium tracking-widest uppercase"
        style={{ color: "var(--color-muted)" }}
      >
        {label}
      </p>
      <p
        className="mt-1.5 font-mono text-2xl leading-none"
        style={{ color: tone ?? "var(--color-ink)" }}
      >
        {value}
      </p>
      {sub && (
        <p className="mt-1.5 text-[11px] leading-snug" style={{ color: "var(--color-muted)" }}>
          {sub}
        </p>
      )}
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="text-xs font-medium tracking-widest uppercase mb-3"
      style={{ color: "var(--color-muted)" }}
    >
      {children}
    </h2>
  );
}

function TrendChart({ months }: { months: MonthBucket[] }) {
  const peak = Math.max(1, ...months.map((m) => m.hits));
  const anyHits = months.some((m) => m.hits > 0);

  return (
    <div
      className="rounded p-4"
      style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
    >
      {!anyHits ? (
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>
          No hits detected in the last {months.length} months.
        </p>
      ) : (
        <>
          <div className="flex items-end gap-1.5" style={{ height: 96 }}>
            {months.map((m, i) => (
              <div key={m.month} className="flex-1 flex flex-col justify-end items-center gap-1">
                <span
                  className="font-mono text-[10px]"
                  style={{ color: m.hits > 0 ? "var(--color-ink)" : "var(--color-muted)" }}
                >
                  {m.hits}
                </span>
                <div
                  className="w-full rounded-t"
                  title={`${m.label}: ${m.hits} ${plural(m.hits, "hit")}`}
                  style={{
                    // The month in progress is a partial bar — muted so it is
                    // never read as a completed month that fell off a cliff.
                    background:
                      i === months.length - 1 ? "var(--color-border)" : "var(--color-accent)",
                    height: `${m.hits === 0 ? 2 : Math.max(4, Math.round((m.hits / peak) * 76))}px`,
                  }}
                />
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-1.5">
            {months.map((m, i) => (
              <span
                key={m.month}
                className="flex-1 text-center text-[9px] leading-tight"
                style={{ color: "var(--color-muted)" }}
              >
                {/* Year-start and the current month are anchor enough; labelling
                    all thirteen turns the axis into noise at this width. */}
                {i === months.length - 1 || m.month.endsWith("-01") ? m.label : "·"}
              </span>
            ))}
          </div>
          <p className="mt-3 text-[11px]" style={{ color: "var(--color-muted)" }}>
            Hits per month. The final bar is the month in progress.
          </p>
        </>
      )}
    </div>
  );
}

function GrowthRow({ label, note, reading }: { label: string; note: string; reading: GrowthReading }) {
  return (
    <div
      className="flex items-baseline justify-between gap-3 py-2"
      style={{ borderTop: "1px solid var(--color-border)" }}
    >
      <div className="min-w-0">
        <p className="text-xs" style={{ color: "var(--color-ink)" }}>
          {label}
        </p>
        <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
          {note}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="font-mono text-sm" style={{ color: growthTone(reading) }}>
          {growthText(reading)}
        </p>
        <p className="font-mono text-[11px]" style={{ color: "var(--color-muted)" }}>
          {reading.current} vs {reading.previous}
        </p>
      </div>
    </div>
  );
}

function BreakdownCard({
  title,
  slices,
  empty,
  colorFor,
}: {
  title: string;
  slices: BreakdownSlice[];
  empty: string;
  colorFor?: (key: string) => string;
}) {
  const peak = Math.max(1, ...slices.map((s) => s.hits));
  return (
    <div
      className="rounded p-4"
      style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
    >
      <h3
        className="text-xs font-medium tracking-widest uppercase"
        style={{ color: "var(--color-muted)" }}
      >
        {title}
      </h3>
      {slices.length === 0 ? (
        <p className="mt-2 text-xs" style={{ color: "var(--color-muted)" }}>
          {empty}
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {slices.map((s) => (
            <li key={s.key} className="flex items-center gap-2 text-xs">
              <span className="w-28 shrink-0 truncate" style={{ color: "var(--color-ink)" }}>
                {s.label}
              </span>
              <span
                className="h-1.5 flex-1 rounded overflow-hidden"
                style={{ background: "var(--color-bg)" }}
              >
                <span
                  className="block h-full rounded"
                  style={{
                    background: colorFor?.(s.key) ?? "var(--color-accent)",
                    width: `${Math.max(4, Math.round((s.hits / peak) * 100))}%`,
                  }}
                />
              </span>
              <span
                className="w-16 text-right font-mono shrink-0"
                style={{ color: "var(--color-muted)" }}
              >
                {s.hits} · {s.share}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type SortKey = "open" | "total" | "thisMonth" | "prevMonthFull" | "last30d" | "latestAt" | "name";

function MemberBreakdown({
  members,
  memberNoun,
}: {
  members: MemberHitStats[];
  memberNoun: string;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("open");
  const [affectedOnly, setAffectedOnly] = useState(true);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = members.filter(
      (m) => (!affectedOnly || m.total > 0) && (!q || m.name.toLowerCase().includes(q)),
    );
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sort) {
        case "name":
          return a.name.localeCompare(b.name);
        case "latestAt":
          return (b.latestAt ?? 0) - (a.latestAt ?? 0);
        default:
          return b[sort] - a[sort] || b.total - a.total || a.name.localeCompare(b.name);
      }
    });
    return sorted;
  }, [members, query, sort, affectedOnly]);

  const affected = members.filter((m) => m.total > 0).length;

  const columns: { key: SortKey; label: string; align: "left" | "right" }[] = [
    { key: "name", label: memberNoun, align: "left" },
    { key: "total", label: "Lifetime", align: "right" },
    { key: "open", label: "Open", align: "right" },
    { key: "thisMonth", label: "This month", align: "right" },
    { key: "prevMonthFull", label: "Last month", align: "right" },
    { key: "last30d", label: "30 days", align: "right" },
    { key: "latestAt", label: "Last hit", align: "right" },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${memberNoun}s…`}
          className="rounded px-2.5 py-1.5 text-xs"
          style={{
            border: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            color: "var(--color-ink)",
          }}
        />
        <button
          onClick={() => setAffectedOnly((v) => !v)}
          className="rounded px-2.5 py-1.5 text-xs"
          style={{
            border: "1px solid var(--color-border)",
            background: affectedOnly ? "var(--color-accent)" : "var(--color-surface)",
            color: affectedOnly ? "#fff" : "var(--color-muted)",
          }}
        >
          {affectedOnly ? "Affected only" : "All"}
        </button>
        <span className="text-[11px]" style={{ color: "var(--color-muted)" }}>
          {rows.length} shown · {affected} of {members.length} {plural(members.length, memberNoun)}{" "}
          affected
        </span>
      </div>

      {rows.length === 0 ? (
        <p
          className="rounded p-4 text-xs"
          style={{
            border: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            color: "var(--color-muted)",
          }}
        >
          {members.length === 0
            ? `No ${memberNoun}s in scope yet.`
            : affectedOnly
              ? `No ${memberNoun} has a recorded hit.`
              : "No match."}
        </p>
      ) : (
        <div
          className="rounded overflow-x-auto"
          style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
        >
          <table className="w-full text-xs">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className={`px-3 py-2 font-medium tracking-widest uppercase text-[10px] ${
                      c.align === "right" ? "text-right" : "text-left"
                    }`}
                    style={{ color: "var(--color-muted)" }}
                  >
                    <button
                      onClick={() => setSort(c.key)}
                      style={{ color: sort === c.key ? "var(--color-accent)" : "inherit" }}
                    >
                      {c.label}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.talentId} style={{ borderTop: "1px solid var(--color-border)" }}>
                  <td className="px-3 py-2" style={{ color: "var(--color-ink)" }}>
                    {m.name}
                    {m.highRisk > 0 && (
                      <span className="ml-1.5 text-[10px]" style={{ color: RISK_COLORS.high }}>
                        {m.highRisk} high-risk
                      </span>
                    )}
                  </td>
                  <td
                    className="px-3 py-2 text-right font-mono"
                    style={{ color: "var(--color-ink)" }}
                  >
                    {m.total}
                  </td>
                  <td
                    className="px-3 py-2 text-right font-mono"
                    style={{ color: m.open > 0 ? "var(--color-accent)" : "var(--color-muted)" }}
                  >
                    {m.open}
                  </td>
                  <td
                    className="px-3 py-2 text-right font-mono"
                    style={{ color: "var(--color-ink)" }}
                  >
                    {m.thisMonth}
                  </td>
                  <td
                    className="px-3 py-2 text-right font-mono"
                    style={{ color: "var(--color-muted)" }}
                  >
                    {m.prevMonthFull}
                  </td>
                  <td
                    className="px-3 py-2 text-right font-mono"
                    style={{ color: "var(--color-ink)" }}
                  >
                    {m.last30d}
                  </td>
                  <td
                    className="px-3 py-2 text-right font-mono"
                    style={{ color: "var(--color-muted)" }}
                  >
                    {fmtDate(m.latestAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Report ───────────────────────────────────────────────────────────────────

export default function DeepfakeStats({ scope, stats }: DeepfakeStatsPayload) {
  const { lifetime, thisMonth, growth, cohort } = stats;
  const noun = scope.memberNoun;

  return (
    <div className="space-y-8">
      <section>
        <SectionHeading>Lifetime</SectionHeading>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            label="Hits detected"
            value={lifetime.total}
            sub={
              lifetime.firstDetectedAt
                ? `since ${fmtDate(lifetime.firstDetectedAt)}`
                : "no hits recorded yet"
            }
          />
          <Tile
            label="Open now"
            value={lifetime.open}
            tone={lifetime.open > 0 ? "var(--color-accent)" : undefined}
            sub={`${lifetime.takedownRequested} in takedown · ${lifetime.resolved} resolved`}
          />
          <Tile
            label={`${noun[0].toUpperCase()}${noun.slice(1)}s affected`}
            value={`${cohort.withHits}/${cohort.size}`}
            sub={`${cohort.withOpenHits} with an open hit`}
          />
          <Tile
            label="High or critical"
            value={lifetime.highRisk}
            tone={lifetime.highRisk > 0 ? RISK_COLORS.high : undefined}
            sub={`${lifetime.dismissed} dismissed on review`}
          />
        </div>
      </section>

      <section>
        <SectionHeading>{thisMonth.label}</SectionHeading>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            label="Hits this month"
            value={thisMonth.hits}
            sub={`${thisMonth.daysElapsed} ${plural(thisMonth.daysElapsed, "day")} in`}
          />
          <Tile label="Per day" value={thisMonth.perDay} sub="month to date" />
          <Tile
            label="Projected"
            value={thisMonth.projected}
            sub="month-end at the current pace"
          />
          <Tile
            label="Vs last month"
            value={growthText(growth.monthOnMonth)}
            tone={growthTone(growth.monthOnMonth)}
            sub={`same point last month: ${growth.monthOnMonth.previous}`}
          />
        </div>
      </section>

      <section>
        <SectionHeading>Trend</SectionHeading>
        <TrendChart months={stats.months} />
      </section>

      <section>
        <SectionHeading>Growth</SectionHeading>
        <div
          className="rounded px-4 py-1"
          style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
        >
          <GrowthRow
            label="Month to date"
            note="against the same elapsed days of last month"
            reading={growth.monthOnMonth}
          />
          <GrowthRow
            label="Last complete month"
            note="against the month before it"
            reading={growth.completedMonths}
          />
          <GrowthRow
            label="Rolling 30 days"
            note="against the preceding 30 days"
            reading={growth.rolling30d}
          />
        </div>
      </section>

      <section>
        <SectionHeading>Where it is happening</SectionHeading>
        <div className="grid gap-3 sm:grid-cols-2">
          <BreakdownCard
            title="By platform"
            slices={stats.byPlatform}
            empty="No hits to break down."
          />
          <BreakdownCard
            title="By risk level"
            slices={stats.byRisk}
            empty="No hits to break down."
            colorFor={(key) => RISK_COLORS[key] ?? "var(--color-accent)"}
          />
        </div>
      </section>

      <section>
        <SectionHeading>{noun} breakdown</SectionHeading>
        <MemberBreakdown members={stats.members} memberNoun={noun} />
      </section>

      <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
        Counts cover every hit Deep Scan has recorded for {noun}s in scope, including
        those later dismissed on review. Generated {fmtDate(stats.generatedAt)}.
      </p>
    </div>
  );
}

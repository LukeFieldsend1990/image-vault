/**
 * Visual report generator for the full-flow e2e integration test.
 *
 * The test records every step (actor, request, response, DB writes, emails,
 * render-share snapshots) into a FlowReport; this module renders it as a
 * single self-contained HTML file — no external assets — styled in the
 * platform's own design language (minimal, black/white, red accent,
 * typography-led) so it can be opened directly or shared as-is.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { DbWrite, SentEmail } from "./e2e-env";

export interface FileSnapshot {
  label: string;
  directory: string;
  files: { name: string; size: number; sha256?: string | null }[];
}

export interface FlowStep {
  n: number;
  phase: string;
  actor: { name: string; role: string };
  title: string;
  narrative: string;
  request: { method: string; path: string; auth: string; body?: unknown };
  response: { status: number; body: unknown };
  dbWrites: DbWrite[];
  emails: SentEmail[];
  licenceStatus: string | null;
  fileSnapshot?: FileSnapshot;
  checks: string[];
}

export interface FlowReport {
  title: string;
  subtitle: string;
  generatedAt: string;
  personas: { name: string; role: string; org: string; detail: string }[];
  lifecycle: { state: string; reachedAtStep: number | null }[];
  steps: FlowStep[];
  summary: { label: string; value: string }[];
}

function esc(v: unknown): string {
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function json(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2) ?? "null";
  } catch {
    return String(v);
  }
}

/** Compact one-line summary of a DB write for the report. */
function writeSummary(w: DbWrite): { table: string; op: string; detail: string } {
  const payload = (w.op === "insert" ? w.values : w.set) as Record<string, unknown> | undefined;
  const interesting = ["status", "pendingAction", "packageId", "agreedFee", "platformFee", "scrubDeadline", "publishedPackagesJson", "purgeRequestedAt", "scrubAttestedAt"];
  const parts: string[] = [];
  if (payload && typeof payload === "object") {
    for (const key of interesting) {
      if (key in payload && payload[key] !== undefined && payload[key] !== null) {
        const val = typeof payload[key] === "string" ? payload[key] : JSON.stringify(payload[key]);
        parts.push(`${key}: ${String(val)}`);
      }
    }
  }
  return { table: w.table, op: w.op, detail: parts.slice(0, 3).join(" · ") };
}

const CSS = `
:root {
  --paper: #faf9f7;
  --surface: #ffffff;
  --ink: #191713;
  --muted: #75716a;
  --border: #e6e2db;
  --accent: #c0392b;
  --accent-ink: #ffffff;
  --ok: #256e47;
  --warn: #a8700d;
  --mono-bg: #f2f0ec;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #141311;
    --surface: #1c1a17;
    --ink: #ebe7e0;
    --muted: #94908a;
    --border: #2e2b26;
    --accent: #e05a49;
    --accent-ink: #141311;
    --ok: #4fae7d;
    --warn: #d1953a;
    --mono-bg: #211f1b;
  }
}
:root[data-theme="light"] {
  --paper: #faf9f7; --surface: #ffffff; --ink: #191713; --muted: #75716a;
  --border: #e6e2db; --accent: #c0392b; --accent-ink: #ffffff;
  --ok: #256e47; --warn: #a8700d; --mono-bg: #f2f0ec;
}
:root[data-theme="dark"] {
  --paper: #141311; --surface: #1c1a17; --ink: #ebe7e0; --muted: #94908a;
  --border: #2e2b26; --accent: #e05a49; --accent-ink: #141311;
  --ok: #4fae7d; --warn: #d1953a; --mono-bg: #211f1b;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 860px; margin: 0 auto; padding: 48px 24px 96px; }
.mono { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 0.8125rem; }
.label {
  font-size: 0.6875rem; font-weight: 500; letter-spacing: 0.14em;
  text-transform: uppercase; color: var(--muted);
}
header.masthead { border-bottom: 2px solid var(--ink); padding-bottom: 24px; margin-bottom: 32px; }
header.masthead .brand { display: flex; align-items: baseline; gap: 10px; margin-bottom: 20px; }
header.masthead .brand .dot { width: 10px; height: 10px; background: var(--accent); display: inline-block; }
h1 { font-size: 2rem; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 6px; text-wrap: balance; }
.subtitle { color: var(--muted); margin: 0; max-width: 62ch; }
.meta { margin-top: 14px; display: flex; gap: 20px; flex-wrap: wrap; }
.meta span { font-size: 0.8125rem; color: var(--muted); }
section { margin-bottom: 44px; }
section > .label { display: block; margin-bottom: 14px; }

.lifecycle { display: flex; align-items: stretch; gap: 0; overflow-x: auto; border: 1px solid var(--border); background: var(--surface); }
.lifecycle .state { flex: 1; min-width: 130px; padding: 14px 16px; border-right: 1px solid var(--border); }
.lifecycle .state:last-child { border-right: none; }
.lifecycle .state .name { font-weight: 600; font-size: 0.875rem; font-variant-numeric: tabular-nums; }
.lifecycle .state .at { font-size: 0.75rem; color: var(--muted); margin-top: 2px; }
.lifecycle .state.reached .name::before { content: ""; display: inline-block; width: 8px; height: 8px; background: var(--accent); margin-right: 8px; }
.lifecycle .state:not(.reached) { opacity: 0.45; }

.personas { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
.persona { border: 1px solid var(--border); background: var(--surface); padding: 14px 16px; }
.persona .name { font-weight: 600; font-size: 0.9375rem; }
.persona .role { color: var(--accent); font-size: 0.75rem; letter-spacing: 0.1em; text-transform: uppercase; margin: 2px 0 6px; }
.persona .detail { font-size: 0.8125rem; color: var(--muted); }

.phase-head { margin: 40px 0 6px; padding-top: 24px; border-top: 1px solid var(--border); }
.phase-head .label { color: var(--accent); }

.step { display: grid; grid-template-columns: 44px 1fr; gap: 0 18px; margin-top: 22px; }
.step .marker { display: flex; flex-direction: column; align-items: center; }
.step .marker .num {
  width: 34px; height: 34px; border: 1px solid var(--ink); display: flex;
  align-items: center; justify-content: center; font-size: 0.8125rem;
  font-weight: 600; background: var(--surface); font-variant-numeric: tabular-nums;
}
.step .marker .line { flex: 1; width: 1px; background: var(--border); margin-top: 6px; }
.step .card { border: 1px solid var(--border); background: var(--surface); padding: 18px 20px 16px; min-width: 0; }
.step h3 { margin: 0 0 2px; font-size: 1.0625rem; font-weight: 600; text-wrap: balance; }
.step .actor { font-size: 0.8125rem; color: var(--muted); margin-bottom: 10px; }
.step .actor b { color: var(--ink); font-weight: 600; }
.step .narrative { font-size: 0.875rem; margin: 0 0 14px; max-width: 68ch; }
.reqline { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; background: var(--mono-bg); padding: 8px 12px; overflow-x: auto; }
.reqline .method { font-weight: 700; font-size: 0.75rem; letter-spacing: 0.06em; }
.reqline .status { margin-left: auto; font-weight: 600; font-size: 0.75rem; padding: 2px 8px; }
.status.s2 { color: var(--ok); border: 1px solid var(--ok); }
.status.s4 { color: var(--warn); border: 1px solid var(--warn); }
.reqline .auth { color: var(--muted); font-size: 0.75rem; white-space: nowrap; }
details { margin-top: 10px; border-top: 1px dashed var(--border); }
details summary { cursor: pointer; padding: 8px 0 2px; font-size: 0.75rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
details pre { background: var(--mono-bg); padding: 10px 12px; overflow-x: auto; margin: 8px 0 10px; font-size: 0.75rem; line-height: 1.5; }
.facts { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
.fact { display: flex; gap: 10px; align-items: baseline; font-size: 0.8125rem; }
.fact .k { flex: 0 0 88px; color: var(--muted); font-size: 0.6875rem; letter-spacing: 0.1em; text-transform: uppercase; padding-top: 1px; }
.fact .v { min-width: 0; }
.chip { display: inline-block; border: 1px solid var(--border); padding: 1px 8px; margin: 0 6px 4px 0; font-size: 0.75rem; background: var(--mono-bg); }
.chip .op { color: var(--accent); font-weight: 600; margin-right: 5px; }
.check { color: var(--ok); font-size: 0.8125rem; }
.check::before { content: "✓"; margin-right: 8px; font-weight: 700; }
.files { background: var(--mono-bg); padding: 12px 14px; margin-top: 12px; overflow-x: auto; }
.files .dir { color: var(--muted); font-size: 0.6875rem; margin-bottom: 8px; letter-spacing: 0.08em; }
.files table { border-collapse: collapse; width: 100%; }
.files td { padding: 2px 18px 2px 0; font-variant-numeric: tabular-nums; white-space: nowrap; }
.files td.hash { color: var(--muted); max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
.files .empty { color: var(--muted); font-style: italic; }
.badge-status { display: inline-block; font-weight: 600; font-size: 0.75rem; border: 1px solid var(--ink); padding: 2px 10px; }
.badge-status.closed, .badge-status.scrub { background: var(--ink); color: var(--paper); }

.summary { border: 2px solid var(--ink); background: var(--surface); padding: 20px 24px; }
.summary .row { display: flex; gap: 16px; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 0.875rem; }
.summary .row:last-child { border-bottom: none; }
.summary .row .k { flex: 0 0 240px; color: var(--muted); }
.summary .row .v { font-weight: 600; }
footer { margin-top: 56px; padding-top: 16px; border-top: 1px solid var(--border); color: var(--muted); font-size: 0.75rem; }
@media (prefers-reduced-motion: no-preference) {
  .step .card { transition: border-color 120ms ease; }
  .step .card:hover { border-color: var(--muted); }
}
`;

export function renderFlowReport(report: FlowReport): string {
  const phases: string[] = [];
  for (const s of report.steps) {
    if (!phases.includes(s.phase)) phases.push(s.phase);
  }

  const lifecycleHtml = report.lifecycle
    .map(
      (l) => `
      <div class="state ${l.reachedAtStep !== null ? "reached" : ""}">
        <div class="name mono">${esc(l.state)}</div>
        <div class="at">${l.reachedAtStep !== null ? `step ${l.reachedAtStep}` : "not reached"}</div>
      </div>`
    )
    .join("");

  const personasHtml = report.personas
    .map(
      (p) => `
      <div class="persona">
        <div class="name">${esc(p.name)}</div>
        <div class="role">${esc(p.role)}</div>
        <div class="detail">${esc(p.org)}<br>${esc(p.detail)}</div>
      </div>`
    )
    .join("");

  const stepsHtml = phases
    .map((phase, phaseIdx) => {
      const steps = report.steps.filter((s) => s.phase === phase);
      const stepCards = steps
        .map((s, i) => {
          const last = phaseIdx === phases.length - 1 && i === steps.length - 1;
          const statusClass = s.response.status < 400 ? "s2" : "s4";
          const writes = s.dbWrites.map(writeSummary);
          const writesHtml = writes.length
            ? writes
                .map(
                  (w) =>
                    `<span class="chip mono"><span class="op">${esc(w.op)}</span>${esc(w.table)}${w.detail ? ` <span style="color:var(--muted)">— ${esc(w.detail)}</span>` : ""}</span>`
                )
                .join("")
            : `<span style="color:var(--muted);font-size:0.8125rem">none</span>`;
          const emailsHtml = s.emails.length
            ? s.emails
                .map((e) => {
                  const to = Array.isArray(e.to) ? e.to.join(", ") : e.to;
                  return `<div style="font-size:0.8125rem"><span class="mono">${esc(to)}</span> — ${esc(e.subject)}</div>`;
                })
                .join("")
            : null;
          const filesHtml = s.fileSnapshot
            ? `<div class="files mono">
                 <div class="dir">${esc(s.fileSnapshot.label)} — ${esc(s.fileSnapshot.directory)}</div>
                 ${
                   s.fileSnapshot.files.length
                     ? `<table><tbody>${s.fileSnapshot.files
                         .map(
                           (f) =>
                             `<tr><td>${esc(f.name)}</td><td>${esc(formatBytes(f.size))}</td><td class="hash">${f.sha256 ? `sha256 ${esc(f.sha256.slice(0, 16))}…` : ""}</td></tr>`
                         )
                         .join("")}</tbody></table>`
                     : `<div class="empty">directory is empty — all licensed files removed</div>`
                 }
               </div>`
            : "";
          return `
          <article class="step" id="step-${s.n}">
            <div class="marker"><div class="num">${s.n}</div>${last ? "" : '<div class="line"></div>'}</div>
            <div class="card">
              <h3>${esc(s.title)}</h3>
              <div class="actor"><b>${esc(s.actor.name)}</b> · ${esc(s.actor.role)}</div>
              <p class="narrative">${esc(s.narrative)}</p>
              <div class="reqline mono">
                <span class="method">${esc(s.request.method)}</span>
                <span>${esc(s.request.path)}</span>
                <span class="auth">${esc(s.request.auth)}</span>
                <span class="status ${statusClass}">${s.response.status}</span>
              </div>
              ${filesHtml}
              <div class="facts">
                ${s.licenceStatus ? `<div class="fact"><span class="k">Licence</span><span class="v"><span class="badge-status ${s.licenceStatus === "CLOSED" ? "closed" : s.licenceStatus === "SCRUB_PERIOD" ? "scrub" : ""} mono">${esc(s.licenceStatus)}</span></span></div>` : ""}
                <div class="fact"><span class="k">DB writes</span><span class="v">${writesHtml}</span></div>
                ${emailsHtml ? `<div class="fact"><span class="k">Email</span><span class="v">${emailsHtml}</span></div>` : ""}
                ${s.checks.length ? `<div class="fact"><span class="k">Verified</span><span class="v">${s.checks.map((c) => `<div class="check">${esc(c)}</div>`).join("")}</span></div>` : ""}
              </div>
              ${s.request.body !== undefined ? `<details><summary>Request body</summary><pre class="mono">${esc(json(s.request.body))}</pre></details>` : ""}
              <details><summary>Response body</summary><pre class="mono">${esc(json(s.response.body))}</pre></details>
            </div>
          </article>`;
        })
        .join("");
      return `
      <div class="phase-head"><span class="label">Phase ${phaseIdx + 1} of ${phases.length} — ${esc(phase)}</span></div>
      ${stepCards}`;
    })
    .join("");

  const summaryHtml = report.summary
    .map((s) => `<div class="row"><span class="k">${esc(s.label)}</span><span class="v">${esc(s.value)}</span></div>`)
    .join("");

  return `<title>${esc(report.title)}</title>
<style>${CSS}</style>
<div class="wrap">
  <header class="masthead">
    <div class="brand"><span class="dot"></span><span class="label" style="color:var(--ink)">Image Vault — E2E Flow Evidence</span></div>
    <h1>${esc(report.title)}</h1>
    <p class="subtitle">${esc(report.subtitle)}</p>
    <div class="meta">
      <span>Generated ${esc(report.generatedAt)}</span>
      <span>${report.steps.length} steps · ${phases.length} phases · every step exercised the real route handlers</span>
    </div>
  </header>

  <section>
    <span class="label">Licence lifecycle observed</span>
    <div class="lifecycle">${lifecycleHtml}</div>
  </section>

  <section>
    <span class="label">Cast of the run</span>
    <div class="personas">${personasHtml}</div>
  </section>

  <section>
    <span class="label">The flow, step by step</span>
    ${stepsHtml}
  </section>

  <section style="margin-top:48px">
    <span class="label">Outcome</span>
    <div class="summary">${summaryHtml}</div>
  </section>

  <footer>
    Generated by <span class="mono">__tests__/e2e/full-licence-flow.e2e.test.ts</span> —
    run <span class="mono">npm test</span> to regenerate. Route handlers are the production code;
    D1/KV/R2 are in-memory test doubles; file bytes, checksums, and the local render share are real.
  </footer>
</div>`;
}

export function writeFlowReport(report: FlowReport, outFile: string): string {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, renderFlowReport(report), "utf8");
  return outFile;
}

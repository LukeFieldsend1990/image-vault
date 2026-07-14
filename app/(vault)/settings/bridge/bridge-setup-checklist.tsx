"use client";

import { useMemo, useState } from "react";
import {
  RENDER_BRIDGE_IMAGE,
  LOCAL_ACCESS_RULES,
  BRIDGE_LIVE_STATEMENTS,
  type BridgeSetupStatus,
} from "@/lib/bridge/setup";

type StepStatus = "todo" | "waiting" | "done" | "failed";
type StepId = "token" | "install" | "local" | "test" | "attest";
type Os = "windows" | "mac" | "linux";

interface AgentSummary {
  organisationId: string;
  agentOnline?: boolean;
}

const STEPS: { id: StepId; title: string; sub: string }[] = [
  { id: "token", title: "Generate connection token", sub: "A one-time token that ties your installed agent to your organisation on ImageVault." },
  { id: "install", title: "Install the Bridge agent", sub: "Run the container on the machine that hosts your proxy folder, using the token from step 1." },
  { id: "local", title: "Configure local access", sub: "Set up the proxy folder and decide which workstations and render nodes can reach it." },
  { id: "test", title: "Connectivity test", sub: "Confirm the agent has connected to ImageVault end-to-end before going live." },
  { id: "attest", title: "Confirm Bridge is live", sub: "Final sign-off. Your status flips to Ready across all connected productions." },
];

const STATUS_LABEL: Record<StepStatus, string> = {
  todo: "Not started",
  waiting: "Waiting on you",
  done: "Done",
  failed: "Failed",
};

const GREEN = "#166534";
const AMBER = "#b45309";

function statusColors(s: StepStatus): { fg: string; bg: string } {
  if (s === "done") return { fg: GREEN, bg: "rgba(22,101,52,0.1)" };
  if (s === "failed") return { fg: "var(--color-danger)", bg: "rgba(220,38,38,0.1)" };
  if (s === "waiting") return { fg: AMBER, bg: "rgba(180,83,9,0.1)" };
  return { fg: "var(--color-muted)", bg: "transparent" };
}

function Spinner() {
  return (
    <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

function Marker({ status, num }: { status: StepStatus; num: number }) {
  const { fg, bg } = statusColors(status);
  const border = status === "todo" ? "1.5px solid var(--color-border)" : "none";
  return (
    <div
      className="shrink-0 flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold"
      style={{ color: fg, background: bg, border }}
    >
      {status === "done" ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
      ) : status === "failed" ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
      ) : status === "waiting" ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></svg>
      ) : (
        num
      )}
    </div>
  );
}

export default function BridgeSetupChecklist({
  setup,
  vaultUrl,
}: {
  setup: BridgeSetupStatus;
  vaultUrl: string;
}) {
  // Derive the initial per-step status from the server snapshot. A currently
  // online agent counts as a passing connectivity test.
  const initialTestPass = setup.liveAttested || setup.agentOnline;
  const [status, setStatus] = useState<Record<StepId, StepStatus>>({
    token: setup.hasToken ? "done" : "todo",
    install: setup.agentEnrolled ? "done" : setup.hasToken ? "waiting" : "todo",
    local: setup.localAttested ? "done" : "todo",
    test: initialTestPass ? "done" : "todo",
    attest: setup.liveAttested ? "done" : "todo",
  });

  const firstOpen = useMemo<StepId>(() => {
    const order: StepId[] = ["token", "install", "local", "test", "attest"];
    return order.find((id) => status[id] !== "done") ?? "attest";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [expanded, setExpanded] = useState<StepId | null>(setup.liveAttested ? null : firstOpen);
  const [token, setToken] = useState<string | null>(null);
  const [os, setOs] = useState<Os>("windows");
  const [testResult, setTestResult] = useState<"pass" | "fail" | null>(initialTestPass ? "pass" : null);
  const [testFailHint, setTestFailHint] = useState<string | null>(null);
  const [busy, setBusy] = useState<StepId | null>(null);
  const [copied, setCopied] = useState<"token" | "docker" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const doneCount = (Object.values(status) as StepStatus[]).filter((s) => s === "done").length;
  const pct = (doneCount / STEPS.length) * 100;
  const live = status.attest === "done";

  function set(id: StepId, s: StepStatus) {
    setStatus((prev) => ({ ...prev, [id]: s }));
  }

  function copy(value: string, which: "token" | "docker") {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  async function findAgentOnline(): Promise<{ enrolled: boolean; online: boolean }> {
    const res = await fetch("/api/bridge/render-bridge");
    if (!res.ok) return { enrolled: false, online: false };
    const data = (await res.json()) as { agents: AgentSummary[] };
    const mine = data.agents.filter((a) => a.organisationId === setup.orgId);
    return { enrolled: mine.length > 0, online: mine.some((a) => a.agentOnline) };
  }

  async function generateToken() {
    setBusy("token");
    setError(null);
    try {
      const res = await fetch("/api/bridge/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: `Bridge setup — ${setup.orgName}` }),
      });
      if (!res.ok) {
        const b = (await res.json()) as { error?: string };
        setError(b.error ?? "Failed to generate token");
        return;
      }
      const b = (await res.json()) as { token: string };
      setToken(b.token);
      set("token", "done");
      if (status.install !== "done") set("install", "waiting");
      setExpanded("install");
    } catch {
      setError("Network error");
    } finally {
      setBusy(null);
    }
  }

  async function checkAgent() {
    setBusy("install");
    setError(null);
    try {
      const { enrolled, online } = await findAgentOnline();
      if (enrolled) {
        set("install", "done");
        if (online && status.test !== "done") {
          set("test", "done");
          setTestResult("pass");
        }
        setExpanded(status.local === "done" ? "test" : "local");
      } else {
        setError("No agent has connected yet. Run the command above, then check again.");
      }
    } catch {
      setError("Network error");
    } finally {
      setBusy(null);
    }
  }

  async function attest(kind: "local_access" | "bridge_live") {
    const stepId: StepId = kind === "local_access" ? "local" : "attest";
    setBusy(stepId);
    setError(null);
    try {
      const res = await fetch("/api/bridge/attestations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organisationId: setup.orgId, kind }),
      });
      if (!res.ok) {
        const b = (await res.json()) as { error?: string };
        setError(b.error ?? "Failed to record attestation");
        return;
      }
      set(stepId, "done");
      if (kind === "local_access") setExpanded("test");
      else setExpanded(null);
    } catch {
      setError("Network error");
    } finally {
      setBusy(null);
    }
  }

  async function runTest() {
    setBusy("test");
    setError(null);
    setTestFailHint(null);
    try {
      const { enrolled, online } = await findAgentOnline();
      if (online) {
        set("test", "done");
        setTestResult("pass");
        setExpanded("attest");
      } else {
        set("test", "failed");
        setTestResult("fail");
        setTestFailHint(
          enrolled
            ? "The agent is enrolled but hasn't sent a heartbeat in the last minute. Check it's running and can reach ImageVault, then test again."
            : "No agent has connected yet. Make sure step 2 completed, then test again.",
        );
      }
    } catch {
      setError("Network error");
    } finally {
      setBusy(null);
    }
  }

  const dockerToken = token ?? "<YOUR_BRIDGE_TOKEN>";
  const dockerCmd = [
    "docker run -d \\",
    "  --name render-bridge \\",
    "  --restart unless-stopped \\",
    `  -e CASBRIDGE_VAULT_URL=${vaultUrl} \\`,
    `  -e CASBRIDGE_SERVICE_TOKEN=${dockerToken} \\`,
    `  -e CASBRIDGE_ORGANISATION_ID=${setup.orgId} \\`,
    "  -e CASBRIDGE_SHARE_PATH=/share \\",
    "  -e CASBRIDGE_STATE_DIR=/state \\",
    "  -v /path/to/render/share:/share \\",
    "  -v render-bridge-state:/state \\",
    `  ${RENDER_BRIDGE_IMAGE}`,
  ].join("\n");

  const canAttest =
    status.token === "done" && status.install === "done" && status.local === "done" && status.test === "done";

  const cardBtn =
    "rounded border px-3 py-2 text-xs font-semibold uppercase tracking-wide transition hover:opacity-80 disabled:opacity-40 inline-flex items-center gap-1.5";

  return (
    <div className="rounded border mb-8" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
      <div className="p-5 border-b" style={{ borderColor: "var(--color-border)" }}>
        <div className="flex items-center justify-between gap-3 mb-1">
          <h2 className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>Bridge setup</h2>
          <span
            className="text-[10px] font-semibold px-2 py-0.5 rounded inline-flex items-center gap-1"
            style={live ? { background: "rgba(22,101,52,0.1)", color: GREEN } : { background: "rgba(180,83,9,0.1)", color: AMBER }}
          >
            {live ? "Bridge live" : "Setup pending"}
          </span>
        </div>
        <p className="text-xs mb-4" style={{ color: "var(--color-muted)" }}>
          The Bridge is the secure connection between your network and ImageVault. Work through these steps to go live —
          you can pause and come back at any time.
        </p>
        <div className="flex items-center gap-3">
          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--color-bg)" }}>
            <div className="h-full transition-all" style={{ width: `${pct}%`, background: GREEN }} />
          </div>
          <span className="text-[11px] font-mono whitespace-nowrap" style={{ color: "var(--color-muted)" }}>
            {doneCount} of {STEPS.length} done
          </span>
        </div>
      </div>

      <div className="p-4 flex flex-col gap-3">
        {STEPS.map((step, i) => {
          const s = status[step.id];
          const { fg, bg } = statusColors(s);
          const isOpen = expanded === step.id;
          return (
            <div key={step.id} className="rounded border overflow-hidden" style={{ borderColor: "var(--color-border)" }}>
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : step.id)}
                className="w-full px-4 py-3 flex items-center gap-3 text-left transition hover:opacity-90"
                style={{ background: s === "done" ? "var(--color-bg)" : "transparent" }}
              >
                <Marker status={s} num={i + 1} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>{step.title}</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>{step.sub}</p>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded whitespace-nowrap" style={{ color: fg, background: bg }}>
                  {STATUS_LABEL[s]}
                </span>
              </button>

              {isOpen && (
                <div className="px-4 pb-4 pt-3 border-t" style={{ borderColor: "var(--color-border)" }}>
                  {/* ── Step 1: token ── */}
                  {step.id === "token" && (
                    <>
                      {token ? (
                        <>
                          <p className="text-xs mb-3" style={{ color: "var(--color-muted)" }}>
                            Token generated. Copy it into the command in the next step — you won&apos;t see it again.
                          </p>
                          <div className="flex items-center gap-2">
                            <code className="flex-1 rounded px-3 py-2 text-xs font-mono select-all overflow-auto" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-ink)" }}>{token}</code>
                            <button type="button" onClick={() => copy(token, "token")} className={cardBtn} style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}>{copied === "token" ? "Copied" : "Copy"}</button>
                          </div>
                        </>
                      ) : status.token === "done" ? (
                        <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                          A bridge token already exists for your account. Generate a fresh one below if you need it for this install.
                        </p>
                      ) : (
                        <p className="text-xs mb-3" style={{ color: "var(--color-muted)" }}>
                          Generate the token that ties your agent to your organisation. Keep it private — anyone with it can connect your Bridge.
                        </p>
                      )}
                      <div className="mt-3">
                        <button type="button" onClick={() => void generateToken()} disabled={busy === "token"} className={cardBtn} style={{ borderColor: "var(--color-ink)", color: "var(--color-ink)" }}>
                          {busy === "token" ? <Spinner /> : null}
                          {token || status.token === "done" ? "Regenerate token" : "Generate token"}
                        </button>
                      </div>
                    </>
                  )}

                  {/* ── Step 2: install ── */}
                  {step.id === "install" && (
                    <>
                      <p className="text-xs mb-3" style={{ color: "var(--color-muted)" }}>
                        Run the Bridge agent on the machine that hosts your proxy folder. The container is the same across platforms —
                        the notes below cover where to run it.
                      </p>
                      <div className="inline-flex gap-1 p-0.5 rounded mb-3" style={{ background: "var(--color-bg)" }}>
                        {(["windows", "mac", "linux"] as Os[]).map((o) => (
                          <button
                            key={o}
                            type="button"
                            onClick={() => setOs(o)}
                            className="text-[11px] px-3 py-1 rounded transition"
                            style={os === o ? { background: "var(--color-surface)", color: "var(--color-ink)", fontWeight: 500 } : { color: "var(--color-muted)" }}
                          >
                            {o === "mac" ? "macOS" : o[0].toUpperCase() + o.slice(1)}
                          </button>
                        ))}
                      </div>
                      <p className="text-[11px] mb-2" style={{ color: "var(--color-muted)" }}>
                        {os === "windows" && "Install Docker Desktop with the WSL 2 backend, then run this in PowerShell."}
                        {os === "mac" && "Install Docker Desktop, then run this in Terminal."}
                        {os === "linux" && "Install Docker Engine, then run this as a user in the docker group."}
                      </p>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "var(--color-muted)" }}>Docker command</span>
                        <button type="button" onClick={() => copy(dockerCmd, "docker")} className="text-[11px] transition hover:opacity-70" style={{ color: copied === "docker" ? GREEN : "var(--color-muted)" }}>{copied === "docker" ? "Copied" : "Copy"}</button>
                      </div>
                      <pre className="rounded text-xs font-mono p-3 overflow-x-auto leading-relaxed select-all" style={{ background: "#0d1117", color: "#e6edf3", border: "1px solid #30363d", whiteSpace: "pre" }}>{dockerCmd}</pre>
                      {!token && status.token !== "done" && (
                        <p className="text-[10px] mt-2" style={{ color: AMBER }}>Generate a token in step 1 first — it will be filled into this command.</p>
                      )}
                      <div className="mt-3">
                        {status.install === "done" ? (
                          <p className="text-xs inline-flex items-center gap-1.5" style={{ color: GREEN }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                            Agent connected.
                          </p>
                        ) : (
                          <button type="button" onClick={() => void checkAgent()} disabled={busy === "install"} className={cardBtn} style={{ borderColor: "var(--color-ink)", color: "var(--color-ink)" }}>
                            {busy === "install" ? <Spinner /> : null}
                            Check for agent
                          </button>
                        )}
                      </div>
                    </>
                  )}

                  {/* ── Step 3: local access ── */}
                  {step.id === "local" && (
                    <>
                      <div className="rounded p-3 mb-3 flex gap-2 text-xs" style={{ background: "rgba(180,83,9,0.08)", border: `1px solid ${AMBER}`, color: "var(--color-ink)" }}>
                        <svg className="shrink-0 mt-0.5" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={AMBER} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                        <span>This happens on your network — we can&apos;t verify it remotely, so you confirm it here. The audit log captures who confirms and when.</span>
                      </div>
                      <p className="text-xs font-medium mb-2" style={{ color: "var(--color-ink)" }}>What needs to be true on your network:</p>
                      <ul className="text-xs list-disc pl-5 mb-3 space-y-1" style={{ color: "var(--color-muted)" }}>
                        {LOCAL_ACCESS_RULES.map((r) => <li key={r}>{r}</li>)}
                      </ul>
                      <button type="button" onClick={() => void attest("local_access")} disabled={busy === "local" || status.local === "done"} className={cardBtn} style={{ borderColor: "var(--color-ink)", color: "var(--color-ink)" }}>
                        {busy === "local" ? <Spinner /> : null}
                        {status.local === "done" ? "Confirmed" : "I've configured local access"}
                      </button>
                    </>
                  )}

                  {/* ── Step 4: connectivity test ── */}
                  {step.id === "test" && (
                    <>
                      <p className="text-xs mb-3" style={{ color: "var(--color-muted)" }}>
                        Confirm the agent is connected and sending heartbeats to ImageVault before going live.
                      </p>
                      {testResult === "pass" && (
                        <div className="rounded p-3 mb-3 text-xs" style={{ background: "rgba(22,101,52,0.08)", border: `1px solid ${GREEN}`, color: "var(--color-ink)" }}>
                          <strong style={{ fontWeight: 500 }}>Test passed.</strong> The agent is online and reachable. The connection is working.
                        </div>
                      )}
                      {testResult === "fail" && (
                        <div className="rounded p-3 mb-3 text-xs" style={{ background: "rgba(220,38,38,0.08)", border: "1px solid var(--color-danger)", color: "var(--color-ink)" }}>
                          <strong style={{ fontWeight: 500 }}>Test failed.</strong> {testFailHint}
                        </div>
                      )}
                      {(() => {
                        const canRun = status.install === "done" && status.local === "done";
                        return (
                          <>
                            <button type="button" onClick={() => void runTest()} disabled={busy === "test" || !canRun} className={cardBtn} style={{ borderColor: "var(--color-ink)", color: "var(--color-ink)" }}>
                              {busy === "test" ? <Spinner /> : null}
                              {testResult ? "Run test again" : "Run connectivity test"}
                            </button>
                            {!canRun && (
                              <p className="text-[11px] mt-2" style={{ color: "var(--color-muted)" }}>Install the agent and configure local access before running the test.</p>
                            )}
                          </>
                        );
                      })()}
                    </>
                  )}

                  {/* ── Step 5: attest / go live ── */}
                  {step.id === "attest" && (
                    <>
                      {live ? (
                        <div className="rounded p-4 text-xs" style={{ background: "rgba(22,101,52,0.08)", border: `1px solid ${GREEN}`, color: "var(--color-ink)" }}>
                          <p className="text-sm font-medium mb-1" style={{ color: "var(--color-ink)" }}>Bridge is live.</p>
                          <p style={{ color: "var(--color-muted)" }}>
                            {setup.orgName} is now Ready on every connected production, and the productions that invited you have been notified.
                            The audit log captures this attestation and the time it was made.
                          </p>
                        </div>
                      ) : (
                        <>
                          <p className="text-xs mb-3" style={{ color: "var(--color-muted)" }}>
                            Final sign-off. Once you confirm, {setup.orgName} flips to Ready across all connected productions, and the productions that invited you are notified.
                          </p>
                          <div className="rounded p-3 mb-3 text-xs" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}>
                            <strong style={{ fontWeight: 500, color: "var(--color-ink)" }}>By confirming, you attest that:</strong>
                            <ul className="list-disc pl-5 mt-2 space-y-1" style={{ color: "var(--color-muted)" }}>
                              {BRIDGE_LIVE_STATEMENTS.map((b) => <li key={b}>{b}</li>)}
                            </ul>
                          </div>
                          <button type="button" onClick={() => void attest("bridge_live")} disabled={busy === "attest" || !canAttest} className={cardBtn} style={{ borderColor: "var(--color-ink)", color: "var(--color-ink)" }}>
                            {busy === "attest" ? <Spinner /> : null}
                            Confirm Bridge is live
                          </button>
                          {!canAttest && (
                            <p className="text-[11px] mt-2" style={{ color: "var(--color-muted)" }}>Finish steps 1 to 4 before signing off.</p>
                          )}
                        </>
                      )}
                    </>
                  )}

                  {error && expanded === step.id && (
                    <p className="text-xs mt-3" style={{ color: "var(--color-danger)" }}>{error}</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

"use client";

const STEPS = ["Welcome", "Password", "2FA", "Terms", "Done"] as const;

/**
 * Shared split-panel shell for the agent onboarding arc, matching the signup /
 * 2FA aesthetic. `step` (1-indexed) drives the progress rail. The 2FA step lives
 * on the shared /setup-2fa page, so this shell renders steps 1, 2, 4 and 5.
 */
export function AgentShell({
  step,
  title,
  subtitle,
  children,
}: {
  step: number;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      {/* ── Left panel ── */}
      <div className="flex flex-1 flex-col justify-between px-12 py-12 lg:px-16">
        <div>
          <span className="text-xs font-semibold tracking-[0.2em] uppercase text-[--color-ink]">
            Image Vault
          </span>
        </div>

        <div className="w-full max-w-sm">
          {/* Progress rail */}
          <ol className="mb-8 flex items-center gap-2">
            {STEPS.map((label, i) => {
              const n = i + 1;
              const done = n < step;
              const current = n === step;
              return (
                <li key={label} className="flex flex-1 flex-col gap-1.5">
                  <span
                    className="h-1 w-full rounded-full transition"
                    style={{
                      background: done || current ? "var(--color-accent)" : "var(--color-border)",
                      opacity: current ? 1 : done ? 0.85 : 1,
                    }}
                  />
                  <span
                    className="text-[10px] font-medium tracking-wide uppercase"
                    style={{ color: current ? "var(--color-ink)" : "var(--color-muted)" }}
                  >
                    {label}
                  </span>
                </li>
              );
            })}
          </ol>

          <h1 className="mb-1 text-3xl font-semibold tracking-tight text-[--color-ink]">{title}</h1>
          {subtitle && <p className="mb-8 text-sm text-[--color-muted]">{subtitle}</p>}

          {children}
        </div>

        <p className="text-xs text-[--color-muted]">
          &copy; {new Date().getFullYear()} Image Vault. All rights reserved.
        </p>
      </div>

      {/* ── Right panel ── */}
      <div
        className="hidden lg:flex lg:w-[45%] flex-col justify-between p-16"
        style={{ background: "var(--color-sidebar)" }}
      >
        <div />
        <div>
          <p
            className="text-3xl font-light leading-snug tracking-tight"
            style={{ color: "var(--color-sidebar-fg)" }}
          >
            Act for your talent.
            <br />
            Decide with confidence.
          </p>
          <p className="mt-4 text-sm leading-relaxed" style={{ color: "var(--color-sidebar-muted)" }}>
            Requests from productions route to your agency inbox. You review the
            scope, then grant, refuse, forward, or counter — every action audited.
          </p>
        </div>
        <div className="text-xs" style={{ color: "var(--color-sidebar-muted)" }}>
          <span className="font-medium" style={{ color: "var(--color-sidebar-fg)" }}>
            Two-factor is mandatory.
          </span>{" "}
          Your agent identity and the decisions made under it are protected at
          every step.
        </div>
      </div>
    </div>
  );
}

export const inputClass =
  "block w-full border border-[--color-border] bg-white px-4 py-3 text-sm text-[--color-ink] placeholder-[--color-border] outline-none transition focus:border-[--color-accent] read-only:opacity-60 read-only:cursor-not-allowed";

export const labelClass =
  "block text-xs font-medium tracking-wide uppercase text-[--color-muted] mb-1.5";

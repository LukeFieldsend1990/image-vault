/**
 * The Inlay — the brand's one dark "statement" panel (deck: `.mob-card.hero`).
 *
 * Ink-900 ground, paper text, a single serif statement with emphasis in
 * accent-tint (brick is too dark on dark; per the on-ink rules). It is the only dark chrome the brand
 * permits, so the rule is strict: **at most one Inlay per page**, and only for
 * a human / consent / identity *statement* — never a metric grid, a list row,
 * or navigation. Its power is that it is rare.
 *
 * Compose a statement with <em> for the tinted emphasis, e.g.
 *   <Inlay eyebrow="Your control"
 *          footnote="Consent bound · Purge guaranteed" gate>
 *     Three people opened your scan. <em>You saw every one.</em>
 *   </Inlay>
 */

import type { ReactNode } from "react";

export default function Inlay({
  eyebrow,
  children,
  footnote,
  gate = false,
  aside,
  className = "",
}: {
  /** Mono uppercase kicker above the statement. */
  eyebrow?: ReactNode;
  /** The statement. Wrap the emphasised clause in <em> for the tinted italic. */
  children: ReactNode;
  /** Mono uppercase line under the statement (paired with the gate device). */
  footnote?: ReactNode;
  /** Show the two-bar gate device beside the footnote. */
  gate?: boolean;
  /** Optional element pinned to the right (ring, avatar) — keep it dark-safe. */
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-6 ${className}`}
      style={{
        background: "var(--color-ink)",
        color: "#fff",
        borderRadius: "var(--radius)",
        padding: "24px 26px",
      }}
    >
      <div className="min-w-0">
        {eyebrow && (
          <p
            className="font-mono uppercase"
            style={{
              fontSize: "10px",
              letterSpacing: "0.14em",
              color: "rgba(255,255,255,0.55)",
              marginBottom: "10px",
            }}
          >
            {eyebrow}
          </p>
        )}

        <h2
          style={{
            fontFamily: "var(--font-serif)",
            fontWeight: 600,
            fontSize: "clamp(20px, 2.4vw, 26px)",
            lineHeight: 1.2,
            letterSpacing: "-0.01em",
            color: "rgba(255,255,255,0.96)",
            margin: 0,
          }}
          className="inlay-statement"
        >
          {children}
        </h2>

        {(footnote || gate) && (
          <div
            className="flex items-center font-mono uppercase"
            style={{
              gap: "10px",
              marginTop: "16px",
              fontSize: "10px",
              letterSpacing: "0.06em",
              color: "rgba(255,255,255,0.7)",
            }}
          >
            {gate && (
              <span className="flex items-stretch" style={{ gap: "3px", height: "14px" }} aria-hidden>
                <span style={{ width: "3px", borderRadius: "1.5px", background: "var(--color-accent-tint)" }} />
                <span style={{ width: "3px", borderRadius: "1.5px", background: "var(--color-accent-tint)" }} />
              </span>
            )}
            {footnote}
          </div>
        )}
      </div>

      {aside && <div className="shrink-0">{aside}</div>}

      {/* accent-tint emphasis for any <em> inside the statement */}
      <style>{`.inlay-statement em { font-style: italic; color: var(--color-accent-tint); }`}</style>
    </div>
  );
}

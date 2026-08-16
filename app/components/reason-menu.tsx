"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Two-step "pick a reason" control — dismiss a hit, whitelist an account.
 *
 * The panel is positioned `fixed` rather than `absolute`, measured off the
 * trigger each time it opens. Both callers live inside cards that clip their
 * own overflow (the platform accent edge needs `overflow-hidden`), and an
 * absolutely-positioned dropdown gets cut off at the card boundary — which is
 * how the reasons ended up half-visible on desktop. A fixed panel is laid out
 * against the viewport instead, so no ancestor can clip it, and it can be
 * clamped and flipped to stay on screen.
 *
 * Placement anchors to either the top or the bottom edge rather than
 * measuring the panel, so the position is known the moment the trigger is
 * clicked and the panel never paints in the wrong place first.
 *
 * Under `sm` it becomes a bottom sheet: these triggers sit in a wrapping
 * action row, so a right-anchored panel ran off the side of a phone.
 */

export interface ReasonOption {
  reason: string;
  label: string;
}

interface Props {
  /** Text on the trigger button. */
  triggerLabel: string;
  options: ReasonOption[];
  /** Fired with the chosen reason; notes are set only for "other". */
  onPick: (reason: string, notes?: string) => void;
  busy?: boolean;
  /** Placeholder for the free-text field behind the "other" option. */
  notesPlaceholder: string;
  /** Label on the button that submits the free-text reason. */
  confirmLabel: string;
  /** Desktop panel width in px. */
  width?: number;
}

type Placement =
  | { mode: "sheet" }
  | { mode: "anchor"; left: number; top?: number; bottom?: number; maxHeight: number };

const MOBILE_BREAKPOINT = 640;
const MARGIN = 12;
/** Below this much room the panel flips above the trigger. Roughly the height
 *  of the notes step, which is the tallest thing the panel shows. */
const FLIP_THRESHOLD = 200;

export default function ReasonMenu({
  triggerLabel,
  options,
  onPick,
  busy = false,
  notesPlaceholder,
  confirmLabel,
  width = 224,
}: Props) {
  const [open, setOpen] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [placement, setPlacement] = useState<Placement>({ mode: "sheet" });
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setOtherOpen(false);
  }, []);

  const measure = useCallback((): Placement => {
    const trigger = triggerRef.current;
    if (!trigger || window.innerWidth < MOBILE_BREAKPOINT) return { mode: "sheet" };

    const rect = trigger.getBoundingClientRect();
    const left = Math.min(
      Math.max(MARGIN, rect.right - width),
      Math.max(MARGIN, window.innerWidth - width - MARGIN)
    );
    const spaceBelow = window.innerHeight - rect.bottom - MARGIN;
    const spaceAbove = rect.top - MARGIN;

    if (spaceBelow < FLIP_THRESHOLD && spaceAbove > spaceBelow) {
      return {
        mode: "anchor",
        left,
        bottom: window.innerHeight - rect.top + 4,
        maxHeight: spaceAbove,
      };
    }
    return { mode: "anchor", left, top: rect.bottom + 4, maxHeight: spaceBelow };
  }, [width]);

  const toggle = () => {
    if (open) {
      close();
      return;
    }
    setPlacement(measure());
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const reposition = () => setPlacement(measure());
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", reposition);
    // Capture phase: the panel has to follow the trigger when any scrollable
    // ancestor moves, not just the window.
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, close, measure]);

  const pick = (reason: string) => {
    if (reason === "other") {
      setOtherOpen(true);
      return;
    }
    close();
    onPick(reason);
  };

  const submitOther = () => {
    const trimmed = notes.trim();
    if (!trimmed) return;
    close();
    setNotes("");
    onPick("other", trimmed);
  };

  const sheet = placement.mode === "sheet";
  const panelStyle: React.CSSProperties = sheet
    ? { background: "var(--color-bg)", border: "1px solid var(--color-border)" }
    : {
        background: "var(--color-bg)",
        border: "1px solid var(--color-border)",
        width,
        left: placement.left,
        top: placement.top,
        bottom: placement.bottom,
        maxHeight: placement.maxHeight,
        overflowY: "auto",
      };

  return (
    <>
      <button
        ref={triggerRef}
        onClick={toggle}
        disabled={busy}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50"
        style={{
          borderColor: "var(--color-border)",
          color: "var(--color-muted)",
          borderRadius: "var(--radius)",
        }}
      >
        {triggerLabel}
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <>
          {/* Dim backdrop on phones (the sheet is modal there); an invisible
              catcher on desktop so clicking away closes the panel. */}
          <div
            onClick={close}
            className="fixed inset-0 z-40"
            style={{ background: sheet ? "rgba(0,0,0,0.45)" : "transparent" }}
          />
          <div
            className={
              sheet ? "fixed z-50 inset-x-3 bottom-3 rounded shadow-lg" : "fixed z-50 rounded shadow-lg"
            }
            style={panelStyle}
          >
            {otherOpen ? (
              <div className="p-2 space-y-2">
                <p className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "var(--color-muted)" }}>
                  Reason
                </p>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  autoFocus
                  maxLength={500}
                  rows={3}
                  placeholder={notesPlaceholder}
                  className="w-full text-xs rounded px-2 py-1.5 resize-none"
                  style={{
                    border: "1px solid var(--color-border)",
                    background: "var(--color-surface)",
                    color: "var(--color-ink)",
                  }}
                />
                <div className="flex gap-1 justify-end">
                  <button
                    onClick={() => {
                      setOtherOpen(false);
                      setNotes("");
                    }}
                    className="text-xs px-2 py-1 rounded"
                    style={{ color: "var(--color-muted)" }}
                  >
                    Back
                  </button>
                  <button
                    onClick={submitOther}
                    disabled={!notes.trim()}
                    className="text-xs px-2 py-1 rounded"
                    style={{
                      background: notes.trim() ? "var(--color-ink)" : "var(--color-surface)",
                      color: notes.trim() ? "white" : "var(--color-muted)",
                    }}
                  >
                    {confirmLabel}
                  </button>
                </div>
              </div>
            ) : (
              options.map((opt) => (
                <button
                  key={opt.reason}
                  onClick={() => pick(opt.reason)}
                  className="block w-full text-left text-xs px-3 py-3 sm:py-2 hover:opacity-80"
                  style={{ color: "var(--color-ink)" }}
                >
                  {opt.label}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </>
  );
}

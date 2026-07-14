"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

const SRC = "/explainer/imagevault-explainer.html";

// Handshake with the embedded film: it announces READY once its script is
// listening, and holds its opening frame until we post PLAY (which we do when
// the frame scrolls into view).
const FILM_READY = "imagevault-explainer:ready";
const FILM_PLAY = "imagevault-explainer:play";

const COARSE_POINTER = "(pointer: coarse)";

function subscribeCoarsePointer(onChange: () => void) {
  const mql = window.matchMedia(COARSE_POINTER);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/**
 * The explainer film embed, with tap-to-fullscreen.
 *
 * The film preloads but holds its opening frame until it scrolls into view:
 * the bundled asset waits for a play message when embedded (and posts a ready
 * message once listening), and we send it when the IntersectionObserver fires.
 *
 * iPhone Safari does not support the Fullscreen API on iframes (only on
 * <video>), so we fill the viewport with a fixed overlay instead — and attempt
 * the real Fullscreen API as progressive enhancement (Android Chrome, desktop,
 * iPadOS). Either way the frame grows to a portrait viewport, which trips the
 * animation's own logic to rotate 90° and fill the screen.
 */
export default function ExplainerFilm() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [expanded, setExpanded] = useState(false);
  // Play immediately if IntersectionObserver is somehow unavailable.
  const [inView, setInView] = useState(() => typeof IntersectionObserver === "undefined");
  const [filmReady, setFilmReady] = useState(false);

  // Touch devices get a tap-the-whole-surface affordance; pointer devices get a
  // corner control so the iframe's own buttons stay usable. Read via an external
  // store so it's SSR-safe with no hydration flash.
  const isTouch = useSyncExternalStore(
    subscribeCoarsePointer,
    () => window.matchMedia(COARSE_POINTER).matches,
    () => false,
  );

  // Poke the embedded animation so it recomputes its fit (it rotates to fill
  // in portrait) when the frame changes size. The asset is same-origin, so
  // reaching into its window is safe.
  const nudgeFit = useCallback(() => {
    requestAnimationFrame(() => {
      try {
        iframeRef.current?.contentWindow?.dispatchEvent(new Event("resize"));
      } catch {
        /* cross-origin guard — never hit for our own asset */
      }
    });
  }, []);

  // The film holds its opening frame until told to play; start it once a good
  // chunk of the frame has actually been scrolled into view.
  useEffect(() => {
    if (inView) return;
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setInView(true);
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data === FILM_READY && e.source === iframeRef.current?.contentWindow) {
        setFilmReady(true);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!inView || !filmReady) return;
    iframeRef.current?.contentWindow?.postMessage(FILM_PLAY, "*");
  }, [inView, filmReady]);

  const open = useCallback(() => {
    setExpanded(true);
    setInView(true);
    const el = wrapRef.current as
      | (HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> | void })
      | null;
    const req = el?.requestFullscreen ?? el?.webkitRequestFullscreen;
    if (req) {
      try {
        Promise.resolve(req.call(el)).catch(() => {});
      } catch {
        /* ignore — the overlay still fills the screen */
      }
    }
  }, []);

  const close = useCallback(() => {
    setExpanded(false);
    const d = document as Document & { webkitExitFullscreen?: () => void };
    if (d.fullscreenElement) {
      try {
        (d.exitFullscreen ?? d.webkitExitFullscreen)?.call(d);
      } catch {
        /* ignore */
      }
    }
  }, []);

  // While expanded: lock body scroll, recompute fit, and close on Escape.
  useEffect(() => {
    nudgeFit();
    if (!expanded) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [expanded, close, nudgeFit]);

  // Stay in sync if the user leaves OS fullscreen via a system gesture.
  useEffect(() => {
    const onFsChange = () => {
      const d = document as Document & { webkitFullscreenElement?: Element | null };
      if (!d.fullscreenElement && !d.webkitFullscreenElement) setExpanded(false);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange);
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      className={
        expanded
          ? "fixed inset-0 z-[1000] flex items-center justify-center"
          : "mkt-rise relative overflow-hidden"
      }
      style={
        expanded
          ? { background: "#BC3D2C" }
          : {
              borderRadius: "14px",
              boxShadow: "0 24px 70px -28px rgba(0,0,0,0.28)",
            }
      }
    >
      <iframe
        ref={iframeRef}
        src={SRC}
        title="What ImageVault does — a ninety-second explainer film"
        loading="lazy"
        scrolling="no"
        style={
          expanded
            ? { display: "block", width: "100%", height: "100%", border: 0 }
            : { display: "block", width: "100%", aspectRatio: "16 / 9", border: 0 }
        }
      />

      {/* Touch: the whole surface is tappable to go full screen. */}
      {!expanded && isTouch && (
        <button
          type="button"
          onClick={open}
          aria-label="Watch full screen"
          className="absolute inset-0 flex items-end justify-center pb-5"
          style={{ background: "transparent", border: 0, cursor: "pointer" }}
        >
          <span
            className="rounded-full px-4 py-2 text-xs font-medium tracking-wide"
            style={{
              background: "rgba(0,0,0,0.55)",
              color: "#fff",
              backdropFilter: "blur(4px)",
              WebkitBackdropFilter: "blur(4px)",
            }}
          >
            Tap to watch full screen ⤢
          </span>
        </button>
      )}

      {/* Pointer devices: a corner control, leaving the iframe's own controls usable. */}
      {!expanded && !isTouch && (
        <button
          type="button"
          onClick={open}
          aria-label="Full screen"
          className="absolute right-3 bottom-3 rounded px-3 py-2 text-xs font-medium tracking-wide transition hover:opacity-90"
          style={{
            background: "rgba(0,0,0,0.55)",
            color: "#fff",
            backdropFilter: "blur(4px)",
            WebkitBackdropFilter: "blur(4px)",
          }}
        >
          Full screen ⤢
        </button>
      )}

      {expanded && (
        <button
          type="button"
          onClick={close}
          aria-label="Close full screen"
          className="fixed top-4 right-4 z-[1001] flex h-10 w-10 items-center justify-center rounded-full text-lg leading-none"
          style={{
            background: "rgba(0,0,0,0.55)",
            color: "#fff",
            backdropFilter: "blur(4px)",
            WebkitBackdropFilter: "blur(4px)",
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

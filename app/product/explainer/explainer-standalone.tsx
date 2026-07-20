"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

// Same handshake as the /product embed: the film announces READY once its
// script is listening and holds its opening frame until it receives PLAY.
const FILM_READY = "imagevault-explainer:ready";
const FILM_PLAY = "imagevault-explainer:play";

// Current screen rotation, in degrees counterclockwise from the device's
// natural orientation (Screen Orientation API, legacy iOS fallback).
function orientationAngle(): number {
  if (typeof screen !== "undefined" && screen.orientation) {
    return screen.orientation.angle;
  }
  const legacy = (window as Window & { orientation?: number }).orientation;
  return typeof legacy === "number" ? (legacy + 360) % 360 : 0;
}

type Lock = { w: number; h: number; rotate: number };

/**
 * The explainer film filling the whole viewport on its own route. Unlike the
 * /product embed there is no scroll gate — the page *is* the film — so we
 * post PLAY as soon as the film reports READY.
 *
 * Orientation is locked to how the page loaded. The film fits itself to the
 * viewport it starts in (rotating to fill a portrait phone), and re-fitting
 * after an OS rotation letterboxes it behind mobile browser chrome. The web
 * can't lock orientation outside fullscreen (and never on iPhone Safari), so
 * we emulate it: freeze the layout at its loaded size and counter-rotate when
 * the OS rotates the browser, keeping the film glued to the physical screen
 * like a native app with a locked orientation.
 */
export default function ExplainerStandalone({
  src = "/explainer/imagevault-explainer.html",
  filmTitle = "What ImageVault does — the explainer film",
}: {
  src?: string;
  filmTitle?: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const baseRef = useRef<{ w: number; h: number; angle: number } | null>(null);
  const [lock, setLock] = useState<Lock | null>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data === FILM_READY && e.source === iframeRef.current?.contentWindow) {
        iframeRef.current?.contentWindow?.postMessage(FILM_PLAY, "*");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    const fit = () => {
      const angle = orientationAngle();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (!baseRef.current) {
        baseRef.current = { w: vw, h: vh, angle };
      }
      const base = baseRef.current;
      if (angle === base.angle) {
        // iOS Safari fires `resize` with the rotated dimensions BEFORE it
        // updates the orientation angle. An aspect flip while the angle is
        // unchanged is that mid-rotation window — don't clobber the frozen
        // base with rotated dimensions; the orientation event that follows
        // will engage the lock.
        if (vw >= vh !== base.w >= base.h) return;
        // Still in the loaded orientation — fill the viewport and track its
        // size so plain resizes (desktop windows, collapsing URL bars) keep
        // working as before.
        base.w = vw;
        base.h = vh;
        setLock(null);
      } else {
        // Rotated away: pin the frozen layout to the physical screen. The
        // iframe keeps its pre-rotation size, so the film inside never
        // re-fits.
        setLock({ w: base.w, h: base.h, rotate: base.angle - angle });
      }
    };
    fit();
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", fit);
    const so = typeof screen !== "undefined" ? screen.orientation : undefined;
    so?.addEventListener?.("change", fit);
    return () => {
      window.removeEventListener("resize", fit);
      window.removeEventListener("orientationchange", fit);
      so?.removeEventListener?.("change", fit);
    };
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: "#FBFAF7" }}>
      <div
        style={
          lock
            ? {
                position: "absolute",
                left: "50%",
                top: "50%",
                width: lock.w,
                height: lock.h,
                transform: `translate(-50%, -50%) rotate(${lock.rotate}deg)`,
              }
            : { position: "absolute", inset: 0 }
        }
      >
        <iframe
          ref={iframeRef}
          src={src}
          title={filmTitle}
          scrolling="no"
          style={{ display: "block", width: "100%", height: "100%", border: 0 }}
        />
      </div>
      <Link
        href="/product"
        aria-label="Back to the product page"
        className="fixed top-4 right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full text-lg leading-none transition hover:opacity-90"
        style={{
          background: "rgba(0,0,0,0.55)",
          color: "#fff",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
        }}
      >
        ✕
      </Link>
    </div>
  );
}

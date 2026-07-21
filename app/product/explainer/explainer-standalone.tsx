"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

// Same handshake as the /product embed: the film announces READY once its
// script is listening and holds its opening frame until it receives PLAY.
const FILM_READY = "imagevault-explainer:ready";
const FILM_PLAY = "imagevault-explainer:play";

type Fit = { w: number; h: number; rotated: boolean };

/**
 * The explainer film filling the whole viewport on its own route. Unlike the
 * /product embed there is no scroll gate — the page *is* the film — so we
 * post PLAY as soon as the film reports READY.
 *
 * The film is locked horizontal, like a landscape-only video player. The
 * 16:9 stage plain-scales to whatever viewport it gets, so this page always
 * hands it a landscape one: in a portrait viewport the iframe is sized to
 * the rotated viewport (width = vh, height = vw) and turned 90°, so the
 * film reads horizontal across the physical screen; in a landscape viewport
 * it fills the screen untransformed. Everything is derived from the current
 * viewport dimensions on every resize — no frozen layouts, no screen-angle
 * tracking — so repeated device rotations always land the film the right
 * way up.
 */
export default function ExplainerStandalone({
  src = "/explainer/imagevault-explainer.html",
  filmTitle = "What ImageVault does — the explainer film",
}: {
  src?: string;
  filmTitle?: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [fit, setFit] = useState<Fit | null>(null);

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
    const update = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      setFit({ w: vw, h: vh, rotated: vh > vw });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    const so = typeof screen !== "undefined" ? screen.orientation : undefined;
    so?.addEventListener?.("change", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      so?.removeEventListener?.("change", update);
    };
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: "#FBFAF7" }}>
      <div
        style={
          fit?.rotated
            ? {
                position: "absolute",
                left: "50%",
                top: "50%",
                width: fit.h,
                height: fit.w,
                transform: "translate(-50%, -50%) rotate(90deg)",
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

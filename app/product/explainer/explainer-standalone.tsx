"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

const SRC = "/explainer/imagevault-explainer.html";

// Same handshake as the /product embed: the film announces READY once its
// script is listening and holds its opening frame until it receives PLAY.
const FILM_READY = "imagevault-explainer:ready";
const FILM_PLAY = "imagevault-explainer:play";

/**
 * The explainer film filling the whole viewport on its own route. Unlike the
 * /product embed there is no scroll gate — the page *is* the film — so we
 * post PLAY as soon as the film reports READY.
 */
export default function ExplainerStandalone() {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data === FILM_READY && e.source === iframeRef.current?.contentWindow) {
        iframeRef.current?.contentWindow?.postMessage(FILM_PLAY, "*");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div className="fixed inset-0" style={{ background: "#FBFAF7" }}>
      <iframe
        ref={iframeRef}
        src={SRC}
        title="What Image Vault does — the explainer film"
        scrolling="no"
        style={{ display: "block", width: "100%", height: "100%", border: 0 }}
      />
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

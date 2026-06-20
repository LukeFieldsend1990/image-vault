"use client";

import { useState } from "react";

/**
 * Public licence reference (LC-####). Always visible — unlike the decorative
 * <CodeTag> system codes, this is a functional identifier a production shares
 * with a scan house so they can deliver a package against the licence from Scan
 * Transfers. Click to copy.
 */
export default function LicenceRef({ code, className = "" }: { code: string | null | undefined; className?: string }) {
  const [copied, setCopied] = useState(false);
  if (!code) return null;
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(code).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      title="Copy licence reference"
      className={`inline-flex items-center gap-1 font-mono text-[10px] px-1.5 py-0.5 rounded align-middle ${className}`}
      style={{ background: "rgba(192,57,43,0.06)", border: "1px solid rgba(192,57,43,0.22)", color: "var(--color-accent)" }}
    >
      {copied ? "Copied" : code}
    </button>
  );
}

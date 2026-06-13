"use client";

import { createContext, useContext } from "react";

/**
 * "Code view mode" plumbing. The (vault) layout wraps children in
 * <CodesProvider show={user.showCodes}>; <CodeTag> renders a system code only
 * when the viewer has the toggle on. Codes are pure decorators.
 */

const ShowCodesContext = createContext(false);

export function CodesProvider({ show, children }: { show: boolean; children: React.ReactNode }) {
  return <ShowCodesContext.Provider value={show}>{children}</ShowCodesContext.Provider>;
}

export function useShowCodes(): boolean {
  return useContext(ShowCodesContext);
}

export default function CodeTag({ code, className = "" }: { code: string | null | undefined; className?: string }) {
  const show = useShowCodes();
  if (!show || !code) return null;
  return (
    <span
      className={`inline-block font-mono text-[10px] px-1.5 py-0.5 rounded align-middle ${className}`}
      style={{ background: "rgba(192,57,43,0.06)", border: "1px solid rgba(192,57,43,0.22)", color: "var(--color-accent)" }}
      title="System code"
    >
      {code}
    </span>
  );
}

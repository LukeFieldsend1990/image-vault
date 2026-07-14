import type { Metadata } from "next";
import Wordmark from "@/app/components/wordmark";
import PrintButton from "./print-button";

export const metadata: Metadata = {
  title: "ImageVault — Liability brief for studio counsel",
  description:
    "The exposure uncontrolled likeness data creates for a production, and how the gate closes it: consent bound, access gated and audited, verified purge on expiry.",
};

// The studio one-pager from the Brand in Practice reference — a printable
// liability brief for studio counsel. Standalone route, no app or marketing
// chrome: this page is a document.

const Gate = () => (
  <span className="flex items-stretch" style={{ gap: "3px", height: "14px" }} aria-hidden>
    <span style={{ width: "3px", borderRadius: "1.5px", background: "var(--color-accent)" }} />
    <span style={{ width: "3px", borderRadius: "1.5px", background: "var(--color-accent)" }} />
  </span>
);

const STEPS = [
  {
    n: "01",
    title: "Consent bound",
    body: "Permission is tied to the scan at capture. No consent, no access.",
  },
  {
    n: "02",
    title: "Access gated",
    body: "VFX work through a proxy. They use the likeness; they never hold it.",
  },
  {
    n: "03",
    title: "Every touch logged",
    body: "A tamper-evident trail: who opened it, when, for how long.",
  },
  {
    n: "04",
    title: "Verified purge",
    body: "On expiry the scan is destroyed — with proof you can hand to a court.",
  },
];

export default function StudioBriefPage() {
  return (
    <div className="min-h-screen" style={{ background: "var(--color-bg)" }}>
      <div className="mx-auto max-w-3xl px-8 py-12 print:py-6">
        {/* ── Head ── */}
        <div className="flex items-start justify-between gap-6">
          <Wordmark variant="display" tone="ink" style={{ fontSize: "1.35rem" }} />
          <div className="flex items-start gap-4">
            <p
              className="text-right text-[10px] font-semibold uppercase leading-relaxed tracking-widest"
              style={{ color: "var(--color-slate)" }}
            >
              Liability brief
              <br />
              For studio counsel
              <br />
              Confidential
            </p>
            <PrintButton />
          </div>
        </div>

        {/* ── The exposure ── */}
        <p
          className="mt-12 text-[10px] font-semibold uppercase tracking-widest"
          style={{ color: "var(--color-slate)" }}
        >
          The exposure
        </p>
        <h1
          className="mt-3 text-4xl leading-tight"
          style={{ fontFamily: "var(--font-serif)", fontWeight: 600, color: "var(--color-ink)" }}
        >
          Every scan you keep is a liability you can&apos;t{" "}
          <em style={{ color: "var(--color-accent)" }}>see</em>.
        </h1>
        <p className="mt-5 max-w-2xl text-sm leading-relaxed" style={{ color: "var(--color-text)" }}>
          When a performer&apos;s face, body, or voice is scanned, that data sits indefinitely on
          VFX vendors&apos; servers — no record of consent, no control over access, no proof of
          deletion. Under GDPR, BIPA, and SAG-AFTRA&apos;s digital-replica rules, the production
          carries the risk.
        </p>

        <div className="my-10 h-px" style={{ background: "var(--color-border)" }} />

        {/* ── The numbers ── */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div
            className="rounded border p-6"
            style={{ borderColor: "var(--color-border)", background: "var(--color-accent-tint)" }}
          >
            <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-accent-hover)" }}>
              Without ImageVault
            </p>
            <p
              className="mt-2 text-4xl"
              style={{ fontFamily: "var(--font-serif)", fontWeight: 600, color: "var(--color-accent-hover)" }}
            >
              $1–7M+
            </p>
            <p className="mt-3 text-xs leading-relaxed" style={{ color: "var(--color-accent-hover)" }}>
              Per-production exposure: statutory BIPA damages, GDPR penalties, and SAG-AFTRA
              grievance liability for uncontrolled likeness data.
            </p>
          </div>
          <div
            className="rounded border p-6"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
          >
            <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--color-slate)" }}>
              With ImageVault
            </p>
            <p
              className="mt-2 text-4xl"
              style={{ fontFamily: "var(--font-serif)", fontWeight: 600, color: "var(--color-ink)" }}
            >
              &lt;0.5%
            </p>
            <p className="mt-3 text-xs leading-relaxed" style={{ color: "var(--color-text)" }}>
              Of the VFX budget. Consent bound, access gated and audited, data purged on licence
              expiry — the liability is closed, not carried.
            </p>
          </div>
        </div>

        {/* ── How the gate works ── */}
        <p
          className="mt-12 text-[10px] font-semibold uppercase tracking-widest"
          style={{ color: "var(--color-slate)" }}
        >
          How the gate works
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <div
              key={s.n}
              className="rounded border p-4"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              <div className="flex items-center justify-between">
                <Gate />
                <span className="font-mono text-[10px]" style={{ color: "var(--color-slate)" }}>
                  {s.n}
                </span>
              </div>
              <h4
                className="mt-3 text-sm"
                style={{ fontFamily: "var(--font-serif)", fontWeight: 600, color: "var(--color-ink)" }}
              >
                {s.title}
              </h4>
              <p className="mt-1.5 text-xs leading-relaxed" style={{ color: "var(--color-muted)" }}>
                {s.body}
              </p>
            </div>
          ))}
        </div>

        {/* ── Compliance chips ── */}
        <div className="mt-10 flex flex-wrap gap-2">
          {["GDPR Art. 9", "Illinois BIPA", "SAG-AFTRA digital replica", "CCPA"].map((c) => (
            <span
              key={c}
              className="rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-wider"
              style={{ borderColor: "var(--color-border)", color: "var(--color-slate)", background: "var(--color-surface)" }}
            >
              {c}
            </span>
          ))}
        </div>

        {/* ── Foot ── */}
        <div
          className="mt-12 flex flex-col justify-between gap-2 border-t pt-5 text-xs sm:flex-row"
          style={{ borderColor: "var(--color-border)", color: "var(--color-muted)" }}
        >
          <span>ImageVault — Governance for likeness data</span>
          <span style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}>
            Anyone can build a safe. We built the gate.
          </span>
        </div>
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { margin: 14mm; }
        }
      `}</style>
    </div>
  );
}

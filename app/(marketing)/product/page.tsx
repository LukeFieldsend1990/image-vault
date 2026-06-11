import type { Metadata } from "next";
import Link from "next/link";
import { VaultMockup, LicenceMockup, InboxMockup, RoyaltiesMockup } from "./mockups";

export const metadata: Metadata = {
  title: "Image Vault — Your likeness. Your terms.",
  description:
    "A zero-knowledge vault for actors to store, manage, and license high-fidelity likeness scans. Client-side encryption, dual-custody 2FA downloads, and a full audit trail.",
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="mb-3 text-xs font-medium tracking-widest uppercase"
      style={{ color: "var(--color-accent)" }}
    >
      {children}
    </p>
  );
}

export default function ProductPage() {
  return (
    <>
      {/* ─────────────── Hero ─────────────── */}
      <section className="mx-auto max-w-6xl px-6 pt-20 pb-16 md:pt-28">
        <div className="max-w-3xl">
          <SectionLabel>The likeness licensing platform</SectionLabel>
          <h1
            className="text-4xl font-semibold leading-tight tracking-tight md:text-6xl"
            style={{ color: "var(--color-ink)" }}
          >
            Your likeness.
            <br />
            Your terms.
          </h1>
          <p
            className="mt-6 max-w-xl text-base leading-relaxed md:text-lg"
            style={{ color: "var(--color-muted)" }}
          >
            Productions increasingly need high-fidelity scans of real people — and
            talent needs control over where their digital likeness goes. Image Vault
            is the secure middle ground: an encrypted archive where actors store scan
            packages and license access to production companies on their own terms.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              href="/register-interest"
              className="btn-accent px-6 py-3.5 text-sm font-medium tracking-wide text-white transition"
            >
              Request access
            </Link>
            <Link
              href="/login"
              className="px-6 py-3.5 text-sm font-medium tracking-wide transition hover:opacity-60"
              style={{
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius)",
                color: "var(--color-ink)",
              }}
            >
              Sign in to your vault
            </Link>
          </div>
        </div>

        <div className="mkt-rise mt-16">
          <VaultMockup />
        </div>
      </section>

      {/* ─────────────── Value strip ─────────────── */}
      <section className="border-y" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px px-6 py-10 md:grid-cols-4">
          {[
            ["Zero-knowledge", "Files are encrypted in your browser. We never hold plaintext."],
            ["Dual-custody", "Two parties, two factors. No single person can release files."],
            ["Full audit trail", "Every request, approval, and download is logged forever."],
            ["AI-assisted", "Inbound email triaged, classified, and turned into actions."],
          ].map(([title, body]) => (
            <div key={title} className="px-2 py-2 md:px-4">
              <p className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
                {title}
              </p>
              <p className="mt-1.5 text-xs leading-relaxed" style={{ color: "var(--color-muted)" }}>
                {body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ─────────────── Platform tour ─────────────── */}
      <section id="platform" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-20 md:py-28">
        <div className="mb-16 max-w-2xl">
          <SectionLabel>Inside the platform</SectionLabel>
          <h2
            className="text-3xl font-semibold tracking-tight md:text-4xl"
            style={{ color: "var(--color-ink)" }}
          >
            One vault, the whole lifecycle
          </h2>
          <p className="mt-4 text-base leading-relaxed" style={{ color: "var(--color-muted)" }}>
            From the moment a scan session wraps to the day a licence expires,
            everything happens in one place — with the talent in control at every step.
          </p>
        </div>

        <div className="space-y-20 md:space-y-28">
          {/* Licensing */}
          <div className="grid items-center gap-10 md:grid-cols-2 md:gap-16">
            <div>
              <SectionLabel>Licensing</SectionLabel>
              <h3 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
                Approve every use, explicitly
              </h3>
              <p className="mt-4 text-sm leading-relaxed" style={{ color: "var(--color-muted)" }}>
                Production companies request access with defined scope, territory, and
                term. Nothing moves until the talent (or their rep, with delegated
                authority) approves — and even then, release requires a second factor
                from the licensee at download time. That&apos;s dual custody: no single
                party can ever exfiltrate a scan.
              </p>
              <ul className="mt-6 space-y-2.5">
                {[
                  "Scoped licences: production, territory, term, usage type",
                  "Vault lock — freeze all access instantly",
                  "Expiry handled automatically, renewals one click",
                ].map((item) => (
                  <li key={item} className="flex gap-3 text-sm" style={{ color: "var(--color-text)" }}>
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full" style={{ background: "var(--color-accent)" }} />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <LicenceMockup />
          </div>

          {/* Inbox */}
          <div className="grid items-center gap-10 md:grid-cols-2 md:gap-16">
            <div className="md:order-2">
              <SectionLabel>AI inbox</SectionLabel>
              <h3 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
                Your inbound, already sorted
              </h3>
              <p className="mt-4 text-sm leading-relaxed" style={{ color: "var(--color-muted)" }}>
                Licence enquiries, onboarding requests, and scheduling emails arrive
                pre-classified into eleven categories, with names, productions, dates,
                and amounts extracted. Suspicious messages — pressure tactics, spoofed
                senders, prompt injection — are flagged in red before you ever reply.
              </p>
              <ul className="mt-6 space-y-2.5">
                {[
                  "One-click suggested actions, pre-filled from the email",
                  "Risk flags for social engineering and fraud",
                  "Email content is always treated as untrusted data",
                ].map((item) => (
                  <li key={item} className="flex gap-3 text-sm" style={{ color: "var(--color-text)" }}>
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full" style={{ background: "var(--color-accent)" }} />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="md:order-1">
              <InboxMockup />
            </div>
          </div>

          {/* Royalties */}
          <div className="grid items-center gap-10 md:grid-cols-2 md:gap-16">
            <div>
              <SectionLabel>Royalties</SectionLabel>
              <h3 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
                See what your likeness earns
              </h3>
              <p className="mt-4 text-sm leading-relaxed" style={{ color: "var(--color-muted)" }}>
                Every licence carries its commercial terms with it. The Royalty Hub
                gives talent and their representatives a live view of earnings across
                productions — renewals, extensions, and new deals as they land.
              </p>
              <ul className="mt-6 space-y-2.5">
                {[
                  "Live earnings feed across all active licences",
                  "Per-production and per-package breakdowns",
                  "Configurable splits between talent, agency, and platform",
                ].map((item) => (
                  <li key={item} className="flex gap-3 text-sm" style={{ color: "var(--color-text)" }}>
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full" style={{ background: "var(--color-accent)" }} />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <RoyaltiesMockup />
          </div>
        </div>
      </section>

      {/* ─────────────── Feature grid ─────────────── */}
      <section
        id="features"
        className="scroll-mt-20 border-t"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
          <div className="mb-14 max-w-2xl">
            <SectionLabel>Feature set</SectionLabel>
            <h2
              className="text-3xl font-semibold tracking-tight md:text-4xl"
              style={{ color: "var(--color-ink)" }}
            >
              Built for the realities of likeness work
            </h2>
          </div>
          <div className="grid gap-px sm:grid-cols-2 lg:grid-cols-3" style={{ background: "var(--color-border)" }}>
            {[
              [
                "Client-side encryption",
                "Scan packages are encrypted in the browser before upload. Keys never leave your device — a true zero-knowledge architecture.",
              ],
              [
                "Dual-custody downloads",
                "Releasing files requires talent approval and a fresh 2FA confirmation from the licensee. No single point of compromise.",
              ],
              [
                "Licence lifecycle",
                "Request, negotiate, approve, deliver, renew, expire — the full agreement lifecycle tracked in one system of record.",
              ],
              [
                "Processing pipeline",
                "Uploads are validated, classified, and assembled into delivery-ready bundles automatically on a global edge network.",
              ],
              [
                "Rep delegation",
                "Agents and managers see their whole roster, act with delegated authority, and never need the talent's credentials.",
              ],
              [
                "Talent directory",
                "Licensed productions browse a permissioned directory of available talent and request exactly the package they need.",
              ],
              [
                "Immutable audit log",
                "Every session, request, approval, and download is recorded. Compliance reviews take minutes, not weeks.",
              ],
              [
                "Bookings & scheduling",
                "Coordinate scan sessions and capture dates alongside the packages they produce.",
              ],
              [
                "Render Bridge",
                "Signed, token-scoped API access lets approved pipelines pull licensed assets directly — no email attachments, ever.",
              ],
            ].map(([title, body]) => (
              <div key={title} className="p-6" style={{ background: "var(--color-bg)" }}>
                <p className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
                  {title}
                </p>
                <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--color-muted)" }}>
                  {body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────── Security ─────────────── */}
      <section id="security" className="scroll-mt-20" style={{ background: "var(--color-sidebar)" }}>
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
          <div className="grid gap-12 md:grid-cols-2 md:gap-20">
            <div>
              <p
                className="mb-3 text-xs font-medium tracking-widest uppercase"
                style={{ color: "var(--color-accent)" }}
              >
                Security model
              </p>
              <h2
                className="text-3xl font-semibold tracking-tight md:text-4xl"
                style={{ color: "var(--color-sidebar-fg)" }}
              >
                Designed so we can&apos;t betray you
              </h2>
              <p className="mt-6 text-base leading-relaxed" style={{ color: "var(--color-sidebar-muted)" }}>
                A likeness archive is only as trustworthy as its worst day. Image
                Vault is built on the assumption that servers get breached, insiders
                go rogue, and emails lie — and is architected so that none of those
                events can release your files.
              </p>
            </div>
            <div className="space-y-8">
              {[
                [
                  "Zero-knowledge storage",
                  "Encryption and decryption happen in the client. A full database and storage breach yields ciphertext, nothing more.",
                ],
                [
                  "Dual-custody release",
                  "File release requires approval from the talent side and a time-boxed 2FA confirmation from the receiving side.",
                ],
                [
                  "Untrusted by default",
                  "Inbound email is treated as hostile input — screened for prompt injection, spoofing, and pressure tactics before it reaches you.",
                ],
                [
                  "Everything on the record",
                  "An append-only audit trail covers every access decision, so disputes are settled by evidence rather than memory.",
                ],
              ].map(([title, body]) => (
                <div key={title}>
                  <p className="text-sm font-semibold" style={{ color: "var(--color-sidebar-fg)" }}>
                    {title}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--color-sidebar-muted)" }}>
                    {body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────── How it works ─────────────── */}
      <section id="how-it-works" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-20 md:py-28">
        <div className="mb-14 max-w-2xl">
          <SectionLabel>How it works</SectionLabel>
          <h2
            className="text-3xl font-semibold tracking-tight md:text-4xl"
            style={{ color: "var(--color-ink)" }}
          >
            Four steps from scan to screen
          </h2>
        </div>
        <div className="grid gap-10 md:grid-cols-4 md:gap-8">
          {[
            [
              "01",
              "Archive",
              "After a capture session, the scan package is encrypted in your browser and sealed into the vault.",
            ],
            [
              "02",
              "Set terms",
              "Decide who can see that you exist, what can be requested, and lock the vault entirely whenever you choose.",
            ],
            [
              "03",
              "License",
              "Productions request access with explicit scope and term. You or your rep approve, amend, or decline.",
            ],
            [
              "04",
              "Deliver",
              "The licensee confirms with 2FA and receives a time-limited download. Every byte of the handover is audited.",
            ],
          ].map(([num, title, body]) => (
            <div key={num}>
              <p className="text-xs font-medium tracking-widest" style={{ color: "var(--color-accent)" }}>
                {num}
              </p>
              <p className="mt-3 text-base font-semibold" style={{ color: "var(--color-ink)" }}>
                {title}
              </p>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--color-muted)" }}>
                {body}
              </p>
            </div>
          ))}
        </div>

        {/* Roles */}
        <div className="mt-24 grid gap-px sm:grid-cols-3" style={{ background: "var(--color-border)" }}>
          {[
            [
              "For talent",
              "Own the canonical archive of your likeness. Approve every use, watch earnings live, and revoke access at any time.",
            ],
            [
              "For representatives",
              "Manage your whole roster from one desk — triage enquiries, negotiate terms, and act with delegated authority.",
            ],
            [
              "For productions",
              "Source legally licensed, production-ready scan packages with clean chain of title and a verifiable audit trail.",
            ],
          ].map(([title, body]) => (
            <div
              key={title}
              className="p-8"
              style={{ background: "var(--color-surface)" }}
            >
              <p
                className="text-xs font-medium tracking-widest uppercase"
                style={{ color: "var(--color-accent)" }}
              >
                {title}
              </p>
              <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--color-text)" }}>
                {body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ─────────────── Final CTA ─────────────── */}
      <section className="border-t" style={{ borderColor: "var(--color-border)" }}>
        <div className="mx-auto max-w-6xl px-6 py-20 text-center md:py-28">
          <h2
            className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight md:text-5xl"
            style={{ color: "var(--color-ink)" }}
          >
            The industry is scanning.
            <br />
            Make sure you hold the keys.
          </h2>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/register-interest"
              className="btn-accent px-8 py-4 text-sm font-medium tracking-wide text-white transition"
            >
              Request access
            </Link>
            <Link
              href="/login"
              className="px-8 py-4 text-sm font-medium tracking-wide transition hover:opacity-60"
              style={{
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius)",
                color: "var(--color-ink)",
              }}
            >
              Sign in
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

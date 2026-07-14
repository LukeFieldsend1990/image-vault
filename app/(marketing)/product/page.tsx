import type { Metadata } from "next";
import Link from "next/link";
import { VaultMockup, LicenceMockup, InboxMockup, RoyaltiesMockup, ComplianceMockup } from "./mockups";
import ExplainerFilm from "./explainer-film";

export const metadata: Metadata = {
  title: "Image Vault — Your likeness. Your terms.",
  description:
    "A secure vault for actors to store, manage, and license high-fidelity likeness scans. Dual-custody 2FA release, a tamper-evident audit ledger, and SAG-AFTRA Article 39 compliance built in.",
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="mb-3 text-xs font-semibold tracking-widest uppercase"
      style={{ color: "var(--color-slate)" }}
    >
      {children}
    </p>
  );
}

export default function ProductPage() {
  return (
    <>
      {/* ─────────────── Hero ─────────────── */}
      <section className="mx-auto max-w-6xl px-6 pt-14 pb-16 md:pt-20">
        <div className="max-w-3xl">
          <SectionLabel>Governance for likeness data</SectionLabel>
          <h1
            className="text-4xl font-semibold leading-tight tracking-tight md:text-6xl"
            style={{ color: "var(--color-ink)" }}
          >
            Governance,
            <br />
            not storage.
          </h1>
          <p
            className="mt-6 max-w-xl text-base leading-relaxed md:text-lg"
            style={{ color: "var(--color-text)" }}
          >
            ImageVault is the gate every party passes through to use a performer&apos;s
            likeness — consented, audited, and time-bound. Actors store scan packages
            from 200&nbsp;GB to a full terabyte; productions get time-limited, fully
            audited access that leaves no copy behind, and the data is verifiably
            purged when the licence expires.
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
            ["Dual-custody", "Two parties, two factors. No single person can release files."],
            ["Tamper-evident", "Every event sealed into a hash-chained ledger that holds up under legal challenge."],
            ["SAG-AFTRA ready", "Article 39 consent records, strike locks, and one-click compliance certificates."],
            ["AI-assisted", "Inbound email triaged, deals benchmarked, misuse flagged — automatically."],
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

      {/* ─────────────── Explainer film ─────────────── */}
      <section className="mx-auto max-w-6xl px-6 pt-12 pb-2 md:pt-16">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <p
            className="text-xs font-medium tracking-widest uppercase"
            style={{ color: "var(--color-accent)" }}
          >
            What Image Vault does
          </p>
          <p className="text-xs" style={{ color: "var(--color-muted)" }}>
            A ninety-second tour
          </p>
        </div>
        <ExplainerFilm />
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
                Six standard licence types — commercial, film double, game character,
                AI avatar, training data, and monitoring reference — turn one-off
                negotiations into a clear product menu. Nothing moves until the talent
                (or their rep, with delegated authority) approves, and release still
                requires a second factor from the licensee at download time. That&apos;s
                dual custody: no single party can ever exfiltrate a scan.
              </p>
              <ul className="mt-6 space-y-2.5">
                {[
                  "Auto-generated PDF contract with every licence",
                  "Strike lock — freeze usage at any scope, instantly",
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
                productions — and usage-metered licences accrue as each generation or
                render happens, so a likeness earns continuously rather than once.
              </p>
              <ul className="mt-6 space-y-2.5">
                {[
                  "Live earnings feed across all active licences",
                  "Pay-per-use metering with configurable talent / agency / platform splits",
                  "AI fee guidance benchmarks every proposal against real approved deals",
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

          {/* Compliance */}
          <div className="grid items-center gap-10 md:grid-cols-2 md:gap-16">
            <div className="md:order-2">
              <SectionLabel>Compliance</SectionLabel>
              <h3 className="text-2xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
                Proof that holds up
              </h3>
              <p className="mt-4 text-sm leading-relaxed" style={{ color: "var(--color-muted)" }}>
                Every consent, approval, transfer, and download is appended to a
                hash-chained ledger — each event seals the one before it, so the
                record can&apos;t be quietly rewritten. SAG-AFTRA Article 39 obligations
                map directly onto ledger events, and a sealed compliance certificate
                is generated on demand.
              </p>
              <ul className="mt-6 space-y-2.5">
                {[
                  "One-click SAG-AFTRA Article 39 compliance certificate",
                  "Printable chain-of-custody timeline per package",
                  "Covers GDPR Article 9, BIPA, and EU AI Act transparency",
                ].map((item) => (
                  <li key={item} className="flex gap-3 text-sm" style={{ color: "var(--color-text)" }}>
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full" style={{ background: "var(--color-accent)" }} />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="md:order-1">
              <ComplianceMockup />
            </div>
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
                "Licence catalogue",
                "Six standard licence types — commercial, film double, game character, AI avatar, training data, monitoring reference — each with an auto-generated PDF contract.",
              ],
              [
                "Dual-custody downloads",
                "Releasing files requires talent-side approval and a fresh 2FA confirmation from the licensee. No single point of compromise.",
              ],
              [
                "Strike lock",
                "Freeze usage instantly at global, organisation, production, or licence scope — SAG-AFTRA strike protection built into the platform.",
              ],
              [
                "Render Bridge DRM",
                "Licensed assets flow into Unreal and Maya under signed, expiring manifests — revocable per device, with tamper and copy events logged.",
              ],
              [
                "Geometry fingerprinting",
                "Scan geometry is watermarked so leaked or pirated assets can be traced back to the exact licence that released them.",
              ],
              [
                "Anomaly detection",
                "AI watches download and render events for unusual volume, new IPs, and tamper signals — and alerts talent in near real time.",
              ],
              [
                "Tamper-evident ledger",
                "Every consent, access, and transfer is sealed into a hash-chained audit ledger. Compliance reviews take minutes, not weeks.",
              ],
              [
                "AI training registry",
                "Training-data use is blocked unless explicitly opted in — then brokered at the talent's price, with the union notice filed automatically.",
              ],
              [
                "Rep action feed",
                "A nightly AI pass ranks expiring licences, stalled deals, and anomalies into a prioritised to-do list — proactive, not reactive.",
              ],
              [
                "AI fee guidance",
                "Every proposed fee is benchmarked against historical approved deals, flagging below-market offers before they're signed.",
              ],
              [
                "Smart cataloguing",
                "A vision model tags every scan package by type, quality, and angle — so a growing roster library stays searchable with zero manual effort.",
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
                No one acts alone.
                <br />
                Nothing goes unrecorded.
              </h2>
              <p className="mt-6 text-base leading-relaxed" style={{ color: "var(--color-sidebar-muted)" }}>
                A likeness archive is only as trustworthy as its worst day. Image
                Vault is built on the assumption that insiders go rogue, emails lie,
                and assets leak — and is architected so that no single party, the
                platform included, can release a likeness alone.
              </p>
            </div>
            <div className="space-y-8">
              {[
                [
                  "Managed encryption",
                  "AES-256 encryption at rest, TLS 1.3 in transit, and P-256-signed delivery manifests — without putting an irreplaceable terabyte one forgotten passphrase away from loss.",
                ],
                [
                  "Dual-custody release",
                  "File release requires approval from the talent side and a time-boxed 2FA confirmation from the receiving side. That gate is structural, not policy.",
                ],
                [
                  "Untrusted by default",
                  "Inbound email is treated as hostile input — screened for prompt injection, spoofing, and pressure tactics before it reaches you.",
                ],
                [
                  "Everything on the record",
                  "A hash-chained, append-only ledger covers every consent, access, and key use — so disputes are settled by evidence rather than memory.",
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
              "After a capture session, the scan package — up to a full terabyte — is sealed into the vault under encryption at rest and dual-custody access.",
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

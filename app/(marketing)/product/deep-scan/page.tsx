import type { Metadata } from "next";
import Link from "next/link";
import ExplainerFilm from "../explainer-film";
import { MonitorHitsMockup, MonitorWatchlistMockup } from "../monitor-mockups";

export const metadata: Metadata = {
  title: "Deep Scan — ImageVault",
  description:
    "Vault-anchored deepfake and misuse detection. ImageVault sweeps public platforms for synthetic and unauthorised use of a performer's likeness — matched against the ground-truth scan data only the vault holds.",
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

/* ── Detection-layer card ── */
function LayerCard({
  num,
  title,
  proves,
  body,
  moat,
}: {
  num: string;
  title: string;
  proves: string;
  body: string;
  moat?: string;
}) {
  return (
    <div
      className="flex flex-col p-6"
      style={{
        background: "var(--color-bg)",
      }}
    >
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-medium tracking-widest" style={{ color: "var(--color-accent)" }}>
          {num}
        </p>
        {moat && (
          <span
            className="px-1.5 py-0.5 text-[9px] font-medium tracking-wider uppercase"
            style={{
              border: "1px solid var(--color-accent)",
              borderRadius: "var(--radius)",
              color: "var(--color-accent)",
            }}
          >
            {moat}
          </span>
        )}
      </div>
      <p className="mt-3 text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
        {title}
      </p>
      <p className="mt-1 text-xs font-medium" style={{ color: "var(--color-slate)" }}>
        Proves: {proves}
      </p>
      <p className="mt-2.5 text-sm leading-relaxed" style={{ color: "var(--color-muted)" }}>
        {body}
      </p>
    </div>
  );
}

/* ── Coverage-tier ladder — the "more scans, stronger detection" loop ── */
function CoverageLadder() {
  const tiers = [
    {
      name: "Unanchored",
      pct: 12,
      body: "No usable reference imagery yet. Sweeps still run on name and text intent.",
    },
    {
      name: "Baseline",
      pct: 40,
      body: "First reference stills indexed from an archived scan package.",
    },
    {
      name: "Anchored",
      pct: 72,
      body: "A working reference gallery — mesh-only packages reach this via derived turntable renders.",
    },
    {
      name: "Fortified",
      pct: 100,
      body: "Photographic diversity across angles and sessions. The strongest reference set the vault can build.",
    },
  ];
  return (
    <div
      className="overflow-hidden"
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        background: "var(--color-surface)",
      }}
    >
      <div
        className="flex items-center justify-between border-b px-5 py-3"
        style={{ borderColor: "var(--color-border)" }}
      >
        <span
          className="text-[10px] font-medium tracking-widest uppercase"
          style={{ color: "var(--color-muted)" }}
        >
          Detection coverage
        </span>
        <span className="text-[10px]" style={{ color: "var(--color-muted)" }}>
          Scored per talent, from the vault itself
        </span>
      </div>
      <div className="divide-y" style={{ borderColor: "var(--color-border)" }}>
        {tiers.map((t) => (
          <div key={t.name} className="px-5 py-4" style={{ borderColor: "var(--color-border)" }}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
                {t.name}
              </p>
              <span
                className="font-mono text-[10px]"
                style={{ color: t.pct === 100 ? "var(--color-accent)" : "var(--color-muted)" }}
              >
                {t.pct}/100
              </span>
            </div>
            <div
              className="mt-2 h-1 w-full overflow-hidden rounded-full"
              style={{ background: "var(--color-border)" }}
            >
              <div
                className="h-full rounded-full"
                style={{ width: `${t.pct}%`, background: "var(--color-accent)" }}
              />
            </div>
            <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--color-muted)" }}>
              {t.body}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LikenessMonitorPage() {
  return (
    <>
      {/* ─────────────── Hero ─────────────── */}
      <section className="mx-auto max-w-6xl px-6 pt-14 pb-16 md:pt-20">
        <div className="max-w-3xl">
          <SectionLabel>Deep Scan</SectionLabel>
          <h1
            className="text-4xl font-semibold leading-tight tracking-tight md:text-6xl"
            style={{ color: "var(--color-ink)" }}
          >
            The vault
            <br />
            that looks out for you.
          </h1>
          <p
            className="mt-6 max-w-xl text-base leading-relaxed md:text-lg"
            style={{ color: "var(--color-text)" }}
          >
            Deep Scan sweeps public platforms for synthetic and
            unauthorised use of a performer&apos;s likeness — deepfakes, AI
            &ldquo;concept trailers&rdquo;, reposted scans — and matches what it
            finds against the one thing no generic detection service holds:
            the performer&apos;s ground-truth capture data, already in the vault.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              href="/register-interest"
              className="btn-accent px-6 py-3.5 text-sm font-medium tracking-wide text-white transition"
            >
              Request access
            </Link>
            <Link
              href="/product"
              className="px-6 py-3.5 text-sm font-medium tracking-wide transition hover:opacity-60"
              style={{
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius)",
                color: "var(--color-ink)",
              }}
            >
              ← Back to the platform
            </Link>
          </div>
        </div>

        <div className="mkt-rise mt-16">
          <MonitorHitsMockup />
        </div>
      </section>

      {/* ─────────────── Launch trailer ─────────────── */}
      <section className="mx-auto max-w-6xl px-6 pb-16 md:pb-20">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <p
            className="text-xs font-medium tracking-widest uppercase"
            style={{ color: "var(--color-accent)" }}
          >
            The launch trailer
          </p>
          <p className="text-xs" style={{ color: "var(--color-muted)" }}>
            A hundred seconds · tap to pause
          </p>
        </div>
        <ExplainerFilm
          src="/explainer/imagevault-detector-trailer.html?v=8"
          title="Deep Scan — launch trailer"
        />
      </section>

      {/* ─────────────── Value strip ─────────────── */}
      <section className="border-y" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px px-6 py-10 md:grid-cols-4">
          {[
            ["Vault-anchored", "Detection compares against the canonical scan — the most current, highest-fidelity record of a performer that exists."],
            ["Five independent signals", "Identity, synthesis, derivation, body geometry — and a fifth that stays ours."],
            ["Event-aware", "Sweeps surge around cast announcements and trailer drops, when synthetic waves actually arrive."],
            ["Evidence-grade", "Every flag carries specific, reviewable rationale — ready for a takedown letter."],
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

      {/* ─────────────── Why the vault wins ─────────────── */}
      <section id="ground-truth" className="scroll-mt-20" style={{ background: "var(--color-sidebar)" }}>
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
          <div className="grid gap-12 md:grid-cols-2 md:gap-20">
            <div>
              <p
                className="mb-3 text-xs font-medium tracking-widest uppercase"
                style={{ color: "var(--color-accent)" }}
              >
                The ground-truth advantage
              </p>
              <h2
                className="text-3xl font-semibold tracking-tight md:text-4xl"
                style={{ color: "var(--color-sidebar-fg)" }}
              >
                Everyone can look.
                <br />
                Only the vault can compare.
              </h2>
              <p className="mt-6 text-base leading-relaxed" style={{ color: "var(--color-sidebar-muted)" }}>
                A convincing fake can be trained from anything — press photos,
                red-carpet footage, a leaked still, or the scan data itself.
                Generic monitoring services can only compare suspect content
                against the same public imagery everyone else can see.
                ImageVault matches against the performer&apos;s own archived
                captures: calibrated scan stills, mesh geometry, and the exact
                files every production uses. When the source of a fake is
                scan-grade data, the party holding the original scans is the
                only one who can prove it — and as generators improve and
                visual artifacts disappear, detection built on possession of
                the source is the approach that keeps working.
              </p>
              <p className="mt-4 text-base leading-relaxed" style={{ color: "var(--color-sidebar-muted)" }}>
                Every scan a performer archives makes their monitoring
                measurably stronger. Storage and protection stop being separate
                products.
              </p>
            </div>
            <div className="space-y-8">
              {[
                [
                  "Months ahead of the public material",
                  "Deepfakes get built from posted trailers and lagging set leaks. ImageVault sits inside the production workflow, so it holds the most current, detailed record of the artist from the day of capture — months before any of that material is public.",
                ],
                [
                  "A reference gallery built from real captures",
                  "Archived scan packages give the matcher the artist's face from every angle — the same multi-angle, studio-calibrated coverage a production needs for reference is exactly what face-matching needs. The real person, not a fan-site crawl.",
                ],
                [
                  "Turntable renders unlock mesh-only packages",
                  "Packages with no photographic stills aren't blind spots: the pipeline renders reference stills from the scan's own 360° footage or a lit turntable of the mesh itself — coverage generated from geometry only the vault holds.",
                ],
                [
                  "A derivation index over source imagery",
                  "Every reference still is perceptually fingerprinted. Reposts, leaks, screenshots, and re-renders of vault imagery match by hash — robust to recompression and resizing.",
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

      {/* ─────────────── Detection layers ─────────────── */}
      <section id="layers" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-20 md:py-28">
        <div className="mb-14 max-w-2xl">
          <SectionLabel>How detection is layered</SectionLabel>
          <h2
            className="text-3xl font-semibold tracking-tight md:text-4xl"
            style={{ color: "var(--color-ink)" }}
          >
            Five signals, each proving something different
          </h2>
          <p className="mt-4 text-base leading-relaxed" style={{ color: "var(--color-muted)" }}>
            No single detector survives generator progress, so the monitor
            never relies on one. Each candidate is scored by independent
            layers — and a flag requires evidence of likeness <em>and</em>{" "}
            evidence of synthesis or derivation, never one alone.
          </p>
        </div>

        <div className="grid gap-px sm:grid-cols-2 lg:grid-cols-3" style={{ background: "var(--color-border)" }}>
          <LayerCard
            num="01"
            title="Identity"
            proves="the person shown is the talent"
            body="Face matching against the vault-anchored reference gallery — the performer's own scan stills, not public photos. Identity evidence never decays."
          />
          <LayerCard
            num="02"
            title="Synthesis"
            proves="the media is AI-generated"
            body="Embedded provenance markers (C2PA / declared-AI metadata) checked first — deterministic and near-conclusive. A vision model then looks for generation artifacts, with generator-family attribution."
          />
          <LayerCard
            num="03"
            title="Derivation"
            proves="it was built from vault imagery"
            body="Perceptual-hash matching against fingerprinted reference stills catches reposts, leaks, screenshots, and re-renders of the source imagery — imagery nobody else holds."
            moat="Vault-only"
          />
          <LayerCard
            num="04"
            title="Body geometry"
            proves="the body shown is — or isn't — the artist"
            body="The scan's mesh carries the artist's true proportions at production grade. Geometric ground truth no public photo holds, anchoring full-body likeness claims."
            moat="Vault-only"
          />
          <LayerCard
            num="05"
            title="Undisclosed"
            proves="what we keep to ourselves"
            body="A fifth, proprietary signal rides the platform's own workflow. Describing how it works publicly would help exactly the people it catches — so we don't."
            moat="Proprietary"
          />
        </div>

        <div
          className="mt-10 grid gap-10 md:grid-cols-2 md:gap-16"
        >
          <div
            className="rounded p-6"
            style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)", borderRadius: "var(--radius-md)" }}
          >
            <p
              className="text-xs font-medium tracking-widest uppercase"
              style={{ color: "var(--color-accent)" }}
            >
              Precision by design
            </p>
            <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--color-text)" }}>
              A likeness match alone never flags — press photos and fan edits
              would drown the queue. Synthesis evidence alone never flags
              either — AI content that isn&apos;t the performer is not their
              problem. Only the combination raises a hit, and an unmeasured
              signal is recorded as exactly that: <em>not measured</em>, never
              &ldquo;low&rdquo;, and never presented as evidence of authenticity.
            </p>
          </div>
          <div
            className="rounded p-6"
            style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)", borderRadius: "var(--radius-md)" }}
          >
            <p
              className="text-xs font-medium tracking-widest uppercase"
              style={{ color: "var(--color-accent)" }}
            >
              Built for where generators are going
            </p>
            <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--color-text)" }}>
              Artifact detection is an edge that narrows with every generator
              release — which is why it&apos;s one layer here, not the strategy.
              Identity anchored to ground-truth captures, derivation matched
              against source imagery, and signals embedded where only the
              platform can put them don&apos;t decay as fakes get better.
              That&apos;s the part only a vault can do.
            </p>
          </div>
        </div>
      </section>

      {/* ─────────────── Coverage loop ─────────────── */}
      <section
        id="coverage"
        className="scroll-mt-20 border-t"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
          <div className="grid items-center gap-10 md:grid-cols-2 md:gap-16">
            <div>
              <SectionLabel>The coverage loop</SectionLabel>
              <h2 className="text-3xl font-semibold tracking-tight md:text-4xl" style={{ color: "var(--color-ink)" }}>
                Every scan you archive strengthens detection
              </h2>
              <p className="mt-4 text-sm leading-relaxed" style={{ color: "var(--color-muted)" }}>
                Detection coverage is scored per talent, directly from what
                their vault contains. Archive a new scan package and its stills
                join the reference gallery and the derivation index
                automatically; even mesh-only packages contribute through
                pipeline-rendered turntable stills. The tier is honest about
                what it measures — reference quality, with concrete next-upload
                suggestions to climb it.
              </p>
              <ul className="mt-6 space-y-2.5">
                {[
                  "Reference gallery synced automatically from archived packages",
                  "Mesh and video-only scans covered via derived reference stills",
                  "Next-upload suggestions show exactly what would strengthen matching",
                ].map((item) => (
                  <li key={item} className="flex gap-3 text-sm" style={{ color: "var(--color-text)" }}>
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full" style={{ background: "var(--color-accent)" }} />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <CoverageLadder />
          </div>
        </div>
      </section>

      {/* ─────────────── How a sweep works ─────────────── */}
      <section id="sweeps" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-20 md:py-28">
        <div className="mb-14 max-w-2xl">
          <SectionLabel>How a sweep works</SectionLabel>
          <h2
            className="text-3xl font-semibold tracking-tight md:text-4xl"
            style={{ color: "var(--color-ink)" }}
          >
            From public platform to reviewable evidence
          </h2>
        </div>
        <div className="grid gap-10 md:grid-cols-4 md:gap-8">
          {[
            [
              "01",
              "Discover",
              "Live sweeps crawl nine public platforms — short-form video, social feeds, Reddit, image search, stock libraries, and AI-generation sites — on a per-talent cadence, with queries and watched accounts tuned to each performer.",
            ],
            [
              "02",
              "Score",
              "Every candidate is scored by the five detection layers against the vault's reference set and derivation index — plus signals only the platform can carry.",
            ],
            [
              "03",
              "Adjudicate",
              "An AI adjudicator weighs the signals with full context — active vigilance windows, press-material priors, body-geometry context — and writes a specific rationale.",
            ],
            [
              "04",
              "Act",
              "Confirmed hits flow into graduated outreach — from a licence offer to a formal takedown — with the evidence trail attached. Every human verdict feeds back into detector calibration.",
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

        <div className="mkt-rise mt-16 mx-auto max-w-3xl">
          <MonitorWatchlistMockup />
          <p className="mt-4 text-center text-xs" style={{ color: "var(--color-muted)" }}>
            Hits roll up into an account watchlist — reach-ranked operators, not a flat list of posts.
          </p>
        </div>
      </section>

      {/* ─────────────── Explainer film ─────────────── */}
      <section className="mx-auto max-w-6xl px-6 pt-12 pb-14 md:pt-16">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <p
            className="text-xs font-medium tracking-widest uppercase"
            style={{ color: "var(--color-accent)" }}
          >
            What Deep Scan does
          </p>
          <p className="text-xs" style={{ color: "var(--color-muted)" }}>
            A two-minute tour · tap to pause
          </p>
        </div>
        <ExplainerFilm
          src="/explainer/imagevault-likeness-monitor.html?v=6"
          title="Deep Scan — a two-minute explainer film"
        />
      </section>

      {/* ─────────────── Feature grid ─────────────── */}
      <section
        id="capabilities"
        className="scroll-mt-20 border-t"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <div className="mx-auto max-w-6xl px-6 py-20 md:py-28">
          <div className="mb-14 max-w-2xl">
            <SectionLabel>Capabilities</SectionLabel>
            <h2
              className="text-3xl font-semibold tracking-tight md:text-4xl"
              style={{ color: "var(--color-ink)" }}
            >
              Monitoring that behaves like an investigator
            </h2>
          </div>
          <div className="grid gap-px sm:grid-cols-2 lg:grid-cols-3" style={{ background: "var(--color-border)" }}>
            {[
              [
                "Vigilance windows",
                "Synthetic content arrives in waves triggered by cast announcements and trailer drops — often tagged with the character, not the actor. A vigilance window adds persona and production vocabulary to discovery for a bounded period, so a fake that never names the performer is still found.",
              ],
              [
                "Cross-platform pursuit",
                "Misuse operators build audiences, not single posts. When an account is flagged, the monitor probes for the same operator on other platforms — and only confirms a sibling when its content actually matches, never on the name alone.",
              ],
              [
                "Account watchlists",
                "Accounts that have hit once are harvested on every subsequent sweep, with reach tracked — so enforcement priorities follow audience size, not posting order.",
              ],
              [
                "Graduated outreach",
                "Not every hit deserves a legal letter. Outreach templates run from warm (a licensing offer) to cold (formal takedown), each pre-filled with the hit's specific evidence and rationale.",
              ],
              [
                "Human-verdict feedback loop",
                "Every confirmation, dismissal, and whitelist decision is read back as a calibration signal — per-detector and per-talent — so the system learns where it was over- or under-confident.",
              ],
              [
                "Audit and evidence",
                "Sweeps, adjudications, and every hit's signal readings are recorded. Evidence trails say why something was flagged — specific observations, ready for enforcement.",
              ],
              [
                "Nine-platform coverage",
                "Instagram Reels, TikTok, YouTube Shorts, X (Twitter), Pinterest, Reddit, Google Images, Getty / Shutterstock, and AI-generation platforms — each toggleable per platform, so coverage expands deliberately rather than by default.",
              ],
              [
                "Adult communities, badged",
                "Adult communities are exactly where likeness misuse concentrates, so they're inside the sweep — and flagged hits carry an NSFW badge, warning talent before they tap through.",
              ],
              [
                "Managed by your representative",
                "Talent never have to watch the queue alone — representatives triage hits, send takedowns, and manage watchlists on their clients' behalf, with every action on the record.",
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

      {/* ─────────────── Final CTA ─────────────── */}
      <section className="border-t" style={{ borderColor: "var(--color-border)" }}>
        <div className="mx-auto max-w-6xl px-6 py-20 text-center md:py-28">
          <h2
            className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight md:text-5xl"
            style={{ color: "var(--color-ink)" }}
          >
            The fakes are coming either way.
            <br />
            Hold the original.
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed" style={{ color: "var(--color-muted)" }}>
            Detection anchored to ground-truth capture data is only possible
            for the platform that holds it. Archive the scan; the monitoring
            comes with it.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/register-interest"
              className="btn-accent px-8 py-4 text-sm font-medium tracking-wide text-white transition"
            >
              Request access
            </Link>
            <Link
              href="/product"
              className="px-8 py-4 text-sm font-medium tracking-wide transition hover:opacity-60"
              style={{
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius)",
                color: "var(--color-ink)",
              }}
            >
              Explore the platform
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

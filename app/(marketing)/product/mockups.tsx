/**
 * Stylised product mockups for the marketing page.
 *
 * These are CSS recreations of the real app screens (not raster screenshots)
 * so the marketing site stays crisp at any resolution, never leaks real user
 * data, and inherits the theme automatically.
 */

function BrowserFrame({
  url,
  children,
}: {
  url: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="overflow-hidden"
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        background: "var(--color-bg)",
        boxShadow: "0 24px 48px -24px rgba(0,0,0,0.18)",
      }}
    >
      {/* Chrome bar */}
      <div
        className="flex items-center gap-3 border-b px-4 py-2.5"
        style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      >
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: "var(--color-border)" }}
            />
          ))}
        </div>
        <div
          className="flex-1 px-3 py-1 text-center text-[10px]"
          style={{
            background: "var(--color-bg)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius)",
            color: "var(--color-muted)",
          }}
        >
          {url}
        </div>
      </div>
      {children}
    </div>
  );
}

function Chip({ label, accent = false }: { label: string; accent?: boolean }) {
  return (
    <span
      className="px-1.5 py-0.5 text-[9px] font-medium tracking-wider uppercase"
      style={{
        border: `1px solid ${accent ? "var(--color-accent)" : "var(--color-border)"}`,
        borderRadius: "var(--radius)",
        color: accent ? "var(--color-accent)" : "var(--color-muted)",
      }}
    >
      {label}
    </span>
  );
}

function SidebarRail({ active }: { active: string }) {
  const items = ["Dashboard", "Vault", "Licences", "Inbox", "Royalties", "Settings"];
  return (
    <div
      className="hidden w-36 shrink-0 flex-col gap-1 p-4 sm:flex"
      style={{ background: "var(--color-sidebar)" }}
    >
      <span
        className="mb-4 text-[9px] font-semibold tracking-[0.2em] uppercase"
        style={{ color: "var(--color-sidebar-fg)" }}
      >
        Image Vault
      </span>
      {items.map((item) => (
        <span
          key={item}
          className="px-2 py-1.5 text-[10px]"
          style={{
            color: item === active ? "var(--color-sidebar-fg)" : "var(--color-sidebar-muted)",
            background: item === active ? "rgba(255,255,255,0.08)" : "transparent",
            borderRadius: "var(--radius)",
          }}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

/* ── Hero: vault overview with scan packages ── */
export function VaultMockup() {
  const packages = [
    { name: "Principal — Full Body v3", meta: "84 files · 2.1 GB", status: "Sealed" },
    { name: "Facial Capture — 4D Session", meta: "212 files · 6.8 GB", status: "Sealed" },
    { name: "Voice Reference — Studio A", meta: "18 files · 410 MB", status: "Processing" },
  ];
  return (
    <BrowserFrame url="vault.imagevault.app/dashboard">
      <div className="flex" style={{ minHeight: "340px" }}>
        <SidebarRail active="Vault" />
        <div className="flex-1 p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p
                className="text-[9px] font-medium tracking-widest uppercase"
                style={{ color: "var(--color-muted)" }}
              >
                Scan Packages
              </p>
              <p className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
                Your encrypted archive
              </p>
            </div>
            <span className="btn-accent px-2.5 py-1.5 text-[10px] font-medium text-white">
              Upload package
            </span>
          </div>
          <div className="space-y-2.5">
            {packages.map((pkg) => (
              <div
                key={pkg.name}
                className="flex items-center justify-between p-3"
                style={{
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius)",
                  background: "var(--color-surface)",
                }}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="flex h-8 w-8 items-center justify-center text-[10px] font-semibold"
                    style={{
                      background: "var(--color-sidebar)",
                      color: "var(--color-sidebar-fg)",
                      borderRadius: "var(--radius)",
                    }}
                  >
                    3D
                  </span>
                  <div>
                    <p className="text-[11px] font-medium" style={{ color: "var(--color-ink)" }}>
                      {pkg.name}
                    </p>
                    <p className="text-[10px]" style={{ color: "var(--color-muted)" }}>
                      {pkg.meta}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Chip label="Encrypted" />
                  <Chip label={pkg.status} accent={pkg.status === "Processing"} />
                </div>
              </div>
            ))}
          </div>
          <div
            className="mt-4 flex items-center gap-2 p-3 text-[10px]"
            style={{
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius)",
              color: "var(--color-muted)",
            }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full royalty-live-dot"
              style={{ background: "var(--color-accent)" }}
            />
            Dual-custody active — no release without 2FA from both sides. AES-256 at rest.
          </div>
        </div>
      </div>
    </BrowserFrame>
  );
}

/* ── Licence approval with dual-custody flow ── */
export function LicenceMockup() {
  const terms = [
    ["Licensee", "Aurora Pictures Ltd"],
    ["Production", "Northern Light (Feature)"],
    ["Scope", "Digital double — principal"],
    ["Territory", "Worldwide"],
    ["Term", "24 months"],
  ];
  return (
    <BrowserFrame url="vault.imagevault.app/licences/req-2841">
      <div className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p
              className="text-[9px] font-medium tracking-widest uppercase"
              style={{ color: "var(--color-muted)" }}
            >
              Licence Request
            </p>
            <p className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
              Northern Light — digital double
            </p>
          </div>
          <Chip label="Awaiting approval" accent />
        </div>

        <div
          className="mb-4 divide-y"
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius)",
            borderColor: "var(--color-border)",
          }}
        >
          {terms.map(([k, v]) => (
            <div
              key={k}
              className="flex items-center justify-between px-3 py-2"
              style={{ borderColor: "var(--color-border)" }}
            >
              <span
                className="text-[9px] font-medium tracking-widest uppercase"
                style={{ color: "var(--color-muted)" }}
              >
                {k}
              </span>
              <span className="text-[11px]" style={{ color: "var(--color-ink)" }}>
                {v}
              </span>
            </div>
          ))}
        </div>

        <p
          className="mb-2 text-[9px] font-medium tracking-widest uppercase"
          style={{ color: "var(--color-muted)" }}
        >
          Dual-custody release
        </p>
        <div className="mb-4 space-y-2">
          <div className="flex items-center gap-2.5 text-[11px]" style={{ color: "var(--color-ink)" }}>
            <span
              className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] text-white"
              style={{ background: "var(--color-ink)" }}
            >
              ✓
            </span>
            Talent approval — identity verified
          </div>
          <div className="flex items-center gap-2.5 text-[11px]" style={{ color: "var(--color-muted)" }}>
            <span
              className="flex h-4 w-4 items-center justify-center rounded-full text-[9px]"
              style={{ border: "1px solid var(--color-border)" }}
            >
              2
            </span>
            Licensee 2FA confirmation at download
          </div>
        </div>

        <span className="btn-accent inline-block px-4 py-2 text-[11px] font-medium text-white">
          Approve &amp; issue licence
        </span>
      </div>
    </BrowserFrame>
  );
}

/* ── AI-triaged inbox ── */
export function InboxMockup() {
  return (
    <BrowserFrame url="vault.imagevault.app/inbox">
      <div className="p-5">
        <p
          className="mb-3 text-[9px] font-medium tracking-widest uppercase"
          style={{ color: "var(--color-muted)" }}
        >
          Inbound — AI triage
        </p>
        <div className="space-y-2.5">
          {([
            {
              from: "production@aurorapictures.com",
              subject: "Likeness licence for VFX sequence",
              chips: [{ label: "licence_request" }],
            },
            {
              from: "newclient@castingdesk.io",
              subject: "Onboarding two new clients to the vault",
              chips: [{ label: "onboarding" }],
            },
            {
              from: "unknown@freemail.example",
              subject: "URGENT: release the files immediately",
              chips: [{ label: "urgent_pressure", accent: true }, { label: "suspicious_sender", accent: true }],
            },
          ] as { from: string; subject: string; chips: { label: string; accent?: boolean }[] }[]).map((mail) => (
            <div
              key={mail.from}
              className="p-3"
              style={{
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius)",
                background: "var(--color-surface)",
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-[10px]" style={{ color: "var(--color-muted)" }}>
                  {mail.from}
                </p>
                <div className="flex shrink-0 gap-1.5">
                  {mail.chips.map((c) => (
                    <Chip key={c.label} label={c.label} accent={c.accent} />
                  ))}
                </div>
              </div>
              <p className="mt-1 text-[11px] font-medium" style={{ color: "var(--color-ink)" }}>
                {mail.subject}
              </p>
            </div>
          ))}
        </div>
        <div
          className="mt-3 flex items-center justify-between p-3"
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius)",
          }}
        >
          <div>
            <p
              className="text-[9px] font-medium tracking-widest uppercase"
              style={{ color: "var(--color-muted)" }}
            >
              Suggested action
            </p>
            <p className="text-[11px]" style={{ color: "var(--color-ink)" }}>
              Find Package &amp; Start Licence — pre-filled from email
            </p>
          </div>
          <span className="btn-accent px-3 py-1.5 text-[10px] font-medium text-white">Run</span>
        </div>
      </div>
    </BrowserFrame>
  );
}

/* ── Compliance ledger ── */
export function ComplianceMockup() {
  const events = [
    ["consent.recorded", "Digital replica consent — Article 39.B", "#8f3a…2c1d"],
    ["licence.approved", "Talent + rep sign-off, scope sealed", "#b27e…9e44"],
    ["download.issued", "Dual-custody verified, token expires 15m", "#e91d…077a"],
    ["bridge.manifest_signed", "Render Bridge — P-256 signature", "#41c8…d3b2"],
  ];
  return (
    <BrowserFrame url="vault.imagevault.app/compliance">
      <div className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p
              className="text-[9px] font-medium tracking-widest uppercase"
              style={{ color: "var(--color-muted)" }}
            >
              Compliance Ledger
            </p>
            <p className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
              Chain of custody — Principal v3
            </p>
          </div>
          <Chip label="Hash-chained" />
        </div>
        <div
          className="divide-y"
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius)",
            borderColor: "var(--color-border)",
          }}
        >
          {events.map(([event, detail, hash]) => (
            <div
              key={event}
              className="flex items-center justify-between gap-3 px-3 py-2.5"
              style={{ borderColor: "var(--color-border)" }}
            >
              <div className="min-w-0">
                <p className="font-mono text-[10px] font-medium" style={{ color: "var(--color-ink)" }}>
                  {event}
                </p>
                <p className="truncate text-[10px]" style={{ color: "var(--color-muted)" }}>
                  {detail}
                </p>
              </div>
              <span className="shrink-0 font-mono text-[9px]" style={{ color: "var(--color-muted)" }}>
                {hash}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Chip label="Article 39" accent />
            <Chip label="GDPR Art. 9" />
            <Chip label="EU AI Act" />
          </div>
          <span className="btn-accent px-3 py-1.5 text-[10px] font-medium text-white">
            Generate certificate
          </span>
        </div>
      </div>
    </BrowserFrame>
  );
}

/* ── Royalties hub ── */
export function RoyaltiesMockup() {
  const feed = [
    ["Aurora Pictures Ltd", "Licence renewal — Northern Light", "+ £4,800"],
    ["Halcyon Interactive", "Game likeness — Season 2", "+ £2,150"],
    ["Meridian Broadcasting", "Promo extension — 6 months", "+ £950"],
  ];
  return (
    <BrowserFrame url="vault.imagevault.app/royalties">
      <div className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <p
            className="text-[9px] font-medium tracking-widest uppercase"
            style={{ color: "var(--color-muted)" }}
          >
            Royalty Hub
          </p>
          <span className="flex items-center gap-1.5 text-[10px]" style={{ color: "var(--color-muted)" }}>
            <span
              className="h-1.5 w-1.5 rounded-full royalty-live-dot"
              style={{ background: "var(--color-accent)" }}
            />
            Live
          </span>
        </div>
        <p className="text-3xl font-light tracking-tight" style={{ color: "var(--color-ink)" }}>
          £48,250
        </p>
        <p className="mb-4 text-[10px]" style={{ color: "var(--color-muted)" }}>
          Earned across 12 active licences this year
        </p>
        <div
          className="divide-y"
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius)",
            borderColor: "var(--color-border)",
          }}
        >
          {feed.map(([who, what, amount]) => (
            <div
              key={who}
              className="flex items-center justify-between px-3 py-2.5"
              style={{ borderColor: "var(--color-border)" }}
            >
              <div>
                <p className="text-[11px] font-medium" style={{ color: "var(--color-ink)" }}>
                  {who}
                </p>
                <p className="text-[10px]" style={{ color: "var(--color-muted)" }}>
                  {what}
                </p>
              </div>
              <span className="text-[11px] font-medium" style={{ color: "var(--color-ink)" }}>
                {amount}
              </span>
            </div>
          ))}
        </div>
      </div>
    </BrowserFrame>
  );
}

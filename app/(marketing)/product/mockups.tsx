/**
 * Product mockups for the marketing page.
 *
 * These are CSS recreations of the *real* app screens — faithful to the current
 * Vault, Licences, Likeness Monitor, Royalty Hub and Chain-of-Custody layouts —
 * rather than raster screenshots. That keeps the marketing site crisp at any
 * resolution, theme-aware, and free of real user data: every name, fee and email
 * below is a fictional demo persona ("Marlowe Quinn"), never a real talent.
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

function Chip({
  label,
  accent = false,
  solid = false,
}: {
  label: string;
  accent?: boolean;
  solid?: boolean;
}) {
  if (solid) {
    return (
      <span
        className="px-1.5 py-0.5 text-[9px] font-medium tracking-wider uppercase text-white"
        style={{ background: "var(--color-accent)", borderRadius: "var(--radius)" }}
      >
        {label}
      </span>
    );
  }
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

/** Small green "Ready / Approved" status pill, matching the app. */
function StatusPill({ label }: { label: string }) {
  return (
    <span
      className="px-1.5 py-0.5 text-[9px] font-medium tracking-wider uppercase"
      style={{
        background: "rgba(34,160,90,0.12)",
        color: "#1f8a4c",
        borderRadius: "var(--radius)",
      }}
    >
      {label}
    </span>
  );
}

/** Neutral monogram avatar — never a real face. */
function Avatar({ initials, size = 32 }: { initials: string; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.34,
        borderRadius: "999px",
        background: "linear-gradient(135deg, #3a3a3a, #1a1a1a)",
      }}
    >
      {initials}
    </span>
  );
}

/** The real left nav, in its current order. */
function SidebarRail({ active }: { active: string }) {
  const items = [
    "Vault",
    "Requests",
    "Licences",
    "Productions",
    "Monitor",
    "Bookings",
    "Royalties",
    "Pipeline",
    "Settings",
  ];
  return (
    <div
      className="hidden w-36 shrink-0 flex-col gap-0.5 p-4 sm:flex"
      style={{ background: "var(--color-sidebar)" }}
    >
      <span
        className="mb-4 text-[9px] font-semibold tracking-[0.2em] uppercase"
        style={{ color: "var(--color-sidebar-fg)" }}
      >
        Image Vault
      </span>
      {items.map((item) => {
        const isActive = item === active;
        return (
          <span
            key={item}
            className="px-2 py-1.5 text-[10px]"
            style={{
              color: isActive ? "var(--color-sidebar-fg)" : "var(--color-sidebar-muted)",
              background: isActive ? "rgba(192,57,43,0.18)" : "transparent",
              borderRadius: "var(--radius)",
            }}
          >
            {item}
          </span>
        );
      })}
    </div>
  );
}

/* ── Hero: vault overview with scan packages ── */
export function VaultMockup() {
  const packages = [
    {
      name: "Principal — Full Body v3",
      facility: "Clear Angle",
      date: "13 May 2026",
      files: "415 files",
      size: "21.27 GB",
      tags: [{ label: "Photogrammetry", solid: true }, { label: "Mesh" }, { label: "Textures" }, { label: "MoCap" }],
    },
    {
      name: "Facial Capture — 4D Session",
      facility: "Clear Angle",
      date: "22 Mar 2026",
      files: "414 files",
      size: "21.27 GB",
      tags: [{ label: "Light Stage", solid: true }, { label: "HDR" }, { label: "Face Only" }, { label: "VFX grade" }],
    },
    {
      name: "Hero Reference — Studio A",
      facility: "Almorah",
      date: "07 Jan 2026",
      files: "18 files",
      size: "410 MB",
      tags: [{ label: "Hair" }, { label: "Reference only" }],
    },
  ];
  return (
    <BrowserFrame url="changling.io/dashboard">
      <div className="flex" style={{ minHeight: "360px" }}>
        <SidebarRail active="Vault" />
        <div className="flex flex-1 flex-col">
          <div className="flex-1 p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
                  Your Vault
                </p>
                <p className="text-[10px]" style={{ color: "var(--color-muted)" }}>
                  3 scan packages
                </p>
              </div>
              <span
                className="px-2.5 py-1.5 text-[10px] font-medium text-white"
                style={{ background: "var(--color-ink)", borderRadius: "var(--radius)" }}
              >
                + New Scan Package
              </span>
            </div>
            <div className="space-y-2.5">
              {packages.map((pkg) => (
                <div
                  key={pkg.name}
                  className="flex items-center justify-between gap-3 p-3"
                  style={{
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius)",
                    background: "var(--color-surface)",
                  }}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center text-[9px] font-semibold"
                      style={{
                        background: "var(--color-sidebar)",
                        color: "var(--color-sidebar-fg)",
                        borderRadius: "var(--radius)",
                      }}
                    >
                      3D
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-[11px] font-medium" style={{ color: "var(--color-ink)" }}>
                          {pkg.name}
                        </p>
                        <StatusPill label="Ready" />
                      </div>
                      <p className="text-[10px]" style={{ color: "var(--color-muted)" }}>
                        {pkg.facility} · {pkg.date}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {pkg.tags.map((t) => (
                          <Chip key={t.label} label={t.label} solid={t.solid} />
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[10px] font-medium" style={{ color: "var(--color-ink)" }}>
                      {pkg.files}
                    </p>
                    <p className="text-[10px]" style={{ color: "var(--color-muted)" }}>
                      {pkg.size}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* Stats bar */}
          <div
            className="grid grid-cols-4 gap-2 border-t px-5 py-3"
            style={{ borderColor: "var(--color-border)" }}
          >
            {[
              ["Total scans", "3"],
              ["Storage used", "42.5 GB"],
              ["Active licences", "1"],
              ["Pending requests", "1"],
            ].map(([k, v]) => (
              <div key={k}>
                <p
                  className="text-[8px] font-medium tracking-widest uppercase"
                  style={{ color: "var(--color-muted)" }}
                >
                  {k}
                </p>
                <p className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
                  {v}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </BrowserFrame>
  );
}

/* ── Active licence card with commercial terms ── */
export function LicenceMockup() {
  return (
    <BrowserFrame url="changling.io/vault/licences">
      <div className="p-5">
        <p className="mb-1 text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
          Licences
        </p>
        <div className="mb-4 flex items-center gap-4 border-b pb-2" style={{ borderColor: "var(--color-border)" }}>
          {[
            ["Active", true],
            ["Download Requests", false],
            ["Expired", false],
            ["Ended", false],
          ].map(([label, on]) => (
            <span
              key={label as string}
              className="pb-1 text-[10px]"
              style={{
                color: on ? "var(--color-ink)" : "var(--color-muted)",
                borderBottom: on ? "2px solid var(--color-accent)" : "2px solid transparent",
                fontWeight: on ? 600 : 400,
              }}
            >
              {label}
            </span>
          ))}
        </div>

        <div
          className="p-4"
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius)",
            background: "var(--color-surface)",
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[12px] font-semibold" style={{ color: "var(--color-ink)" }}>
                  Northern Light
                </p>
                <StatusPill label="Approved" />
                <Chip label="Film / Double" />
                <Chip label="● Render Bridge" />
              </div>
              <p className="mt-1 text-[10px]" style={{ color: "var(--color-muted)" }}>
                Aurora Pictures Ltd · Facial Capture — 4D Session
              </p>
              <p
                className="mt-2 text-[10px] underline"
                style={{ color: "var(--color-accent)" }}
              >
                View organisation members
              </p>
              <p className="mt-2 text-[10px]" style={{ color: "var(--color-muted)" }}>
                Period: 10 May 2026 – 25 Dec 2026
              </p>
              <p className="mt-1 text-[10px] font-medium" style={{ color: "var(--color-accent)" }}>
                Agreed fee: $200,000
              </p>
              <p className="text-[10px] font-medium" style={{ color: "var(--color-accent)" }}>
                Your earnings: $160,000
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              {[
                ["Details ▾", false],
                ["Contract", false],
                ["Upload signed", false],
                ["Revoke", true],
              ].map(([label, danger]) => (
                <span
                  key={label as string}
                  className="px-2.5 py-1 text-[9px] font-medium"
                  style={{
                    border: `1px solid ${danger ? "var(--color-accent)" : "var(--color-border)"}`,
                    color: danger ? "var(--color-accent)" : "var(--color-ink)",
                    borderRadius: "var(--radius)",
                    background: "var(--color-bg)",
                  }}
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div
          className="mt-3 flex items-center gap-2 p-3 text-[10px]"
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius)",
            color: "var(--color-muted)",
          }}
        >
          <span className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] text-white" style={{ background: "var(--color-ink)" }}>
            ✓
          </span>
          Talent approved — release still requires the licensee&apos;s 2FA at download. Dual custody.
        </div>
      </div>
    </BrowserFrame>
  );
}

/* ── Likeness Monitor — scanning public platforms for misuse ── */
export function MonitorMockup() {
  const platforms = [
    { name: "YouTube", kind: "Video", state: "2 matches", flag: true },
    { name: "TikTok", kind: "Video", state: "Clear" },
    { name: "Instagram Reels", kind: "Video", state: "Clear" },
    { name: "X (Twitter)", kind: "Social", state: "1 match", flag: true },
    { name: "Google Images", kind: "Search", state: "Clear" },
    { name: "Getty / Shutterstock", kind: "Stock", state: "Clear" },
    { name: "AI Platforms", kind: "AI Gen", state: "Scanning" },
  ];
  return (
    <BrowserFrame url="changling.io/vault/monitor">
      <div className="p-5">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
              Likeness Monitor
            </p>
            <p className="text-[10px]" style={{ color: "var(--color-muted)" }}>
              Scanning public platforms for unauthorised use of Marlowe Quinn.
            </p>
          </div>
          <span
            className="px-2.5 py-1.5 text-[10px] font-medium text-white"
            style={{ background: "var(--color-ink)", borderRadius: "var(--radius)" }}
          >
            ⌕ Run Scan
          </span>
        </div>

        <div
          className="mb-3 flex items-center justify-between p-3"
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius)",
            background: "var(--color-surface)",
          }}
        >
          <div className="flex items-center gap-2.5">
            <Avatar initials="MQ" size={30} />
            <div>
              <div className="flex items-center gap-2">
                <p className="text-[11px] font-semibold" style={{ color: "var(--color-ink)" }}>
                  Marlowe Quinn
                </p>
                <span className="text-[9px]" style={{ color: "#1f8a4c" }}>
                  ✓ Identity Verified
                </span>
              </div>
              <p className="text-[10px]" style={{ color: "var(--color-muted)" }}>
                Tidewater · Vela · Atlas Drift
              </p>
            </div>
          </div>
          <span className="text-[9px]" style={{ color: "var(--color-muted)" }}>
            Monitoring target
          </span>
        </div>

        <div
          className="flex items-center justify-between px-3 py-2"
          style={{ borderTop: "1px solid var(--color-border)", borderInline: "1px solid var(--color-border)", borderTopLeftRadius: "var(--radius)", borderTopRightRadius: "var(--radius)" }}
        >
          <span
            className="text-[9px] font-medium tracking-widest uppercase"
            style={{ color: "var(--color-muted)" }}
          >
            Monitored platforms
          </span>
          <span className="text-[9px]" style={{ color: "var(--color-muted)" }}>
            3 flagged · 7 checked
          </span>
        </div>
        <div
          className="divide-y"
          style={{
            border: "1px solid var(--color-border)",
            borderTop: "none",
            borderBottomLeftRadius: "var(--radius)",
            borderBottomRightRadius: "var(--radius)",
            borderColor: "var(--color-border)",
          }}
        >
          {platforms.map((p) => (
            <div
              key={p.name}
              className="flex items-center justify-between px-3 py-2"
              style={{ borderColor: "var(--color-border)" }}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className="flex h-5 w-5 items-center justify-center text-[8px] font-semibold"
                  style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius)", color: "var(--color-muted)" }}
                >
                  {p.name.slice(0, 2)}
                </span>
                <div>
                  <p className="text-[11px] font-medium" style={{ color: "var(--color-ink)" }}>
                    {p.name}
                  </p>
                  <p className="text-[9px]" style={{ color: "var(--color-muted)" }}>
                    {p.kind}
                  </p>
                </div>
              </div>
              {p.flag ? (
                <Chip label={p.state} accent />
              ) : (
                <span className="text-[9px]" style={{ color: "var(--color-muted)" }}>
                  {p.state}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </BrowserFrame>
  );
}

/* ── Royalty Hub — live pay-per-use meter ── */
export function RoyaltiesMockup() {
  const feed = [
    ["Aurora Pictures Ltd", "AI avatar render — Northern Light", "+ $4,800"],
    ["Halcyon Interactive", "Game likeness — Season 2", "+ $2,150"],
    ["Meridian Broadcasting", "Promo extension — 6 months", "+ $950"],
  ];
  return (
    <BrowserFrame url="changling.io/royalties">
      <div className="p-5">
        <p
          className="text-[9px] font-medium tracking-widest uppercase"
          style={{ color: "var(--color-accent)" }}
        >
          Live Royalty Meter
        </p>
        <p className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
          Royalty Hub
        </p>
        <p className="mb-4 text-[10px]" style={{ color: "var(--color-muted)" }}>
          Pay-as-you-go earnings as your likeness drives AI generation. Updates live every 5s.
        </p>

        <div className="mb-4 flex items-stretch gap-3">
          {/* Radial meter */}
          <div
            className="relative flex w-40 shrink-0 flex-col items-center justify-center p-3"
            style={{
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius)",
              background: "var(--color-surface)",
            }}
          >
            <div className="relative flex h-24 w-24 items-center justify-center">
              <span className="absolute inset-0 rounded-full" style={{ border: "6px solid var(--color-border)", opacity: 0.5 }} />
              <span className="absolute inset-2 rounded-full" style={{ border: "4px solid var(--color-border)", opacity: 0.35 }} />
              <span
                className="absolute h-2 w-2 rounded-full royalty-live-dot"
                style={{ top: "2px", left: "calc(50% - 4px)", background: "var(--color-accent)" }}
              />
              <div className="text-center">
                <p className="text-[7px] font-medium tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
                  Lifetime
                </p>
                <p className="text-base font-semibold" style={{ color: "var(--color-ink)" }}>
                  $48,250
                </p>
                <p className="text-[8px]" style={{ color: "var(--color-muted)" }}>
                  1,284 generations
                </p>
              </div>
            </div>
          </div>

          {/* Stat tiles */}
          <div className="grid flex-1 grid-cols-2 gap-2">
            {[
              ["Today", "$312"],
              ["Last 24h", "$1,180"],
              ["Lifetime", "$48,250"],
              ["Generations", "1,284"],
            ].map(([k, v]) => (
              <div
                key={k}
                className="flex flex-col justify-center p-2.5"
                style={{ border: "1px solid var(--color-border)", borderRadius: "var(--radius)" }}
              >
                <p className="text-[8px] font-medium tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
                  {k}
                </p>
                <p className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
                  {v}
                </p>
              </div>
            ))}
          </div>
        </div>

        <p
          className="mb-2 text-[9px] font-medium tracking-widest uppercase"
          style={{ color: "var(--color-muted)" }}
        >
          Live usage feed
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
              className="flex items-center justify-between px-3 py-2"
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

/* ── Chain-of-custody record — tamper-evident ledger ── */
export function ComplianceMockup() {
  const events = [
    ["01", "Scan package created", "Uploaded by Marlowe Quinn", "2026-05-13 17:00 UTC"],
    ["02", "File added to package", "principal_fb_data_hr.obj · 2.89 GB", "2026-05-13 17:07 UTC"],
    ["03", "Licence approved", "Talent + rep sign-off, scope sealed", "2026-05-18 09:41 UTC"],
    ["04", "Download issued", "Dual-custody verified, token expires 15m", "2026-05-18 09:46 UTC"],
    ["05", "Bridge manifest signed", "Render Bridge — P-256 signature", "2026-05-19 14:02 UTC"],
  ];
  return (
    <BrowserFrame url="changling.io/vault/packages/…/chain-of-custody">
      <div className="p-5">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <p
              className="text-[8px] font-medium tracking-widest uppercase"
              style={{ color: "var(--color-muted)" }}
            >
              Marlowe Quinn · Image Vault
            </p>
            <p className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
              Chain of Custody Record
            </p>
          </div>
          <div className="text-right text-[8px]" style={{ color: "var(--color-muted)" }}>
            <p>Document ref: IMG-20260612-987254</p>
            <p>Generated: 2026-06-12 23:47 UTC</p>
          </div>
        </div>

        <div
          className="mb-4 grid grid-cols-3 gap-x-3 gap-y-2.5 p-3"
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius)",
            background: "var(--color-surface)",
          }}
        >
          {[
            ["Scan package", "Principal — Full Body v3"],
            ["Talent", "Marlowe Quinn"],
            ["Capture date", "13 May 2026"],
            ["Studio / facility", "Clear Angle"],
            ["Total events", "416"],
            ["Status", "Sealed"],
          ].map(([k, v]) => (
            <div key={k}>
              <p className="text-[8px] font-medium tracking-widest uppercase" style={{ color: "var(--color-muted)" }}>
                {k}
              </p>
              <p className="text-[10px] font-medium" style={{ color: "var(--color-ink)" }}>
                {v}
              </p>
            </div>
          ))}
        </div>

        <p
          className="mb-2 text-[9px] font-medium tracking-widest uppercase"
          style={{ color: "var(--color-muted)" }}
        >
          Event log — chronological
        </p>
        <div
          className="divide-y"
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius)",
            borderColor: "var(--color-border)",
          }}
        >
          {events.map(([n, event, detail, ts]) => (
            <div
              key={n}
              className="flex items-start justify-between gap-3 px-3 py-2"
              style={{ borderColor: "var(--color-border)" }}
            >
              <div className="flex min-w-0 gap-2.5">
                <span className="font-mono text-[9px]" style={{ color: "var(--color-muted)" }}>
                  {n}
                </span>
                <div className="min-w-0">
                  <p
                    className="text-[10px] font-semibold tracking-wide uppercase"
                    style={{ color: "var(--color-accent)" }}
                  >
                    {event}
                  </p>
                  <p className="truncate font-mono text-[9px]" style={{ color: "var(--color-muted)" }}>
                    {detail}
                  </p>
                </div>
              </div>
              <span className="shrink-0 font-mono text-[8px]" style={{ color: "var(--color-muted)" }}>
                {ts}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Chip label="Hash-chained" />
            <Chip label="Article 39" accent />
            <Chip label="GDPR Art. 9" />
          </div>
          <span
            className="px-3 py-1.5 text-[10px] font-medium text-white"
            style={{ background: "var(--color-ink)", borderRadius: "var(--radius)" }}
          >
            Print / Export PDF
          </span>
        </div>
      </div>
    </BrowserFrame>
  );
}

/* ── AI-triaged inbound mailbox ── */
export function InboxMockup() {
  return (
    <BrowserFrame url="changling.io/inbox">
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

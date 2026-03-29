export const runtime = "edge";

import { cookies } from "next/headers";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { talentProfiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import InviteLicensee from "./invite-licensee";
import VaultLockToggle from "./vault-lock-toggle";

const ADMIN_EMAILS = ["lukefieldsend@googlemail.com", "martindavison@gmail.com"];

const ADMIN_SECTIONS = [
  { href: "/admin", label: "Overview", description: "Platform-wide stats and health" },
  { href: "/admin/users", label: "Users", description: "Browse, suspend or remove accounts" },
  { href: "/admin/packages", label: "Packages", description: "All scan packages across the platform" },
  { href: "/admin/licences", label: "Licences", description: "Licence requests and approvals" },
  { href: "/admin/downloads", label: "Downloads", description: "Audit dual-custody download events" },
  { href: "/admin/bookings", label: "Bookings", description: "Create popup events and manage slots" },
  { href: "/admin/invites", label: "Invites", description: "Manage platform invitations" },
  { href: "/admin/pipeline", label: "Pipeline", description: "Digital double pipeline jobs" },
  { href: "/admin/talent", label: "Talent Settings", description: "Pipeline, fee splits & permissions" },
  { href: "/admin/audit", label: "Audit Log", description: "Last 500 download events" },
  { href: "/admin/storage", label: "Storage", description: "Per-talent storage usage" },
  { href: "/admin/bridge", label: "Bridge", description: "Active Bridge sessions and tamper event log" },
];

type Role = "talent" | "rep" | "licensee" | "admin";

interface KnownForEntry {
  title: string;
  year?: number;
  type: "movie" | "tv";
}

async function getSessionData(): Promise<{ userId: string; email: string; role: Role } | null> {
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get("session")?.value;
    if (!session) return null;
    const payload = JSON.parse(atob(session.split(".")[1])) as {
      sub?: string;
      email?: string;
      role?: Role;
    };
    return { userId: payload.sub ?? "", email: payload.email ?? "", role: payload.role ?? "talent" };
  } catch {
    return null;
  }
}

const ROLE_LABELS: Record<Role, string> = {
  talent: "Talent",
  rep: "Representative / Agency",
  licensee: "Licensee (Production Co.)",
  admin: "Platform Admin",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const user = await getSessionData();
  const isAdmin = !!(user?.email && ADMIN_EMAILS.includes(user.email));
  const activeTab = tab === "admin" && isAdmin ? "admin" : "account";

  // Fetch talent identity for talent users
  let identity: {
    fullName: string;
    profileImageUrl: string | null;
    tmdbId: number | null;
    knownFor: KnownForEntry[];
    popularity: number | null;
  } | null = null;

  if (user?.role === "talent" && user.userId) {
    try {
      const db = getDb();
      const row = await db
        .select()
        .from(talentProfiles)
        .where(eq(talentProfiles.userId, user.userId))
        .get();
      if (row) {
        identity = {
          fullName: row.fullName,
          profileImageUrl: row.profileImageUrl ?? null,
          tmdbId: row.tmdbId ?? null,
          knownFor: JSON.parse(row.knownFor ?? "[]") as KnownForEntry[],
          popularity: row.popularity ?? null,
        };
      }
    } catch {
      // non-fatal
    }
  }

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-xl font-semibold mb-1" style={{ color: "var(--color-ink)" }}>Settings</h1>
      <p className="text-sm mb-6" style={{ color: "var(--color-muted)" }}>Manage your account and platform preferences.</p>

      {/* Tab bar */}
      <div className="flex gap-0 mb-8 border-b" style={{ borderColor: "var(--color-border)" }}>
        <Link
          href="/settings"
          className="px-4 py-2 text-sm font-medium transition border-b-2 -mb-px"
          style={{
            borderColor: activeTab === "account" ? "var(--color-accent)" : "transparent",
            color: activeTab === "account" ? "var(--color-ink)" : "var(--color-muted)",
          }}
        >
          Account
        </Link>
        {isAdmin && (
          <Link
            href="/settings?tab=admin"
            className="px-4 py-2 text-sm font-medium transition border-b-2 -mb-px"
            style={{
              borderColor: activeTab === "admin" ? "var(--color-accent)" : "transparent",
              color: activeTab === "admin" ? "var(--color-ink)" : "var(--color-muted)",
            }}
          >
            Admin
          </Link>
        )}
      </div>

      {/* ── Admin tab ── */}
      {activeTab === "admin" && (
        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-4" style={{ color: "var(--color-accent)" }}>
            Platform Administration
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {ADMIN_SECTIONS.map((s) => (
              <Link
                key={s.href}
                href={s.href}
                className="rounded border px-4 py-3.5 flex items-start justify-between gap-3 hover:opacity-80 transition group"
                style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
              >
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>{s.label}</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>{s.description}</p>
                </div>
                <svg
                  className="mt-0.5 shrink-0 opacity-40 group-hover:opacity-70 transition"
                  width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  style={{ color: "var(--color-ink)" }}
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── Account tab ── */}
      {activeTab === "account" && (<>

      {/* Profile card */}
      <div className="rounded border p-5 mb-6" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <div className="flex items-center gap-4 mb-4">
          <div
            className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full text-base font-semibold"
            style={{ background: "var(--color-ink)", color: "#fff" }}
          >
            {user?.email?.[0]?.toUpperCase() ?? "?"}
          </div>
          <div>
            <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>{user?.email ?? "—"}</p>
            <p
              className="mt-1 text-[11px] font-medium px-2 py-0.5 rounded inline-block"
              style={{ background: "rgba(192,57,43,0.1)", color: "var(--color-accent)" }}
            >
              {ROLE_LABELS[user?.role ?? "talent"]}
            </p>
          </div>
        </div>

        <div className="space-y-3 border-t pt-4" style={{ borderColor: "var(--color-border)" }}>
          <div className="flex justify-between text-xs">
            <span style={{ color: "var(--color-muted)" }}>Email</span>
            <span style={{ color: "var(--color-text)" }}>{user?.email ?? "—"}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span style={{ color: "var(--color-muted)" }}>Two-factor authentication</span>
            <span className="font-medium" style={{ color: "#166534" }}>Enabled</span>
          </div>
          <div className="flex justify-between text-xs">
            <span style={{ color: "var(--color-muted)" }}>Role</span>
            <span style={{ color: "var(--color-text)" }}>{ROLE_LABELS[user?.role ?? "talent"]}</span>
          </div>
        </div>
      </div>

      {/* ── Industry Identity (talent only) ── */}
      {user?.role === "talent" && (
        <div className="rounded border mb-6 overflow-hidden" style={{ borderColor: "var(--color-border)" }}>
          <div className="px-5 py-3.5 border-b flex items-center justify-between"
            style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
            <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--color-muted)" }}>
              Industry Identity
            </h2>
            {identity?.tmdbId && (
              <span
                className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded"
                style={{ background: "rgba(1,180,228,0.1)", color: "#01b4e4" }}
              >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Identity Verified
              </span>
            )}
          </div>

          <div className="p-5" style={{ background: "var(--color-bg)" }}>
            {identity ? (
              <div className="flex gap-5">
                {/* Photo */}
                <div className="shrink-0">
                  {identity.profileImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={identity.profileImageUrl}
                      alt={identity.fullName}
                      className="rounded object-cover shadow-sm"
                      style={{ width: 72, height: 108 }}
                    />
                  ) : (
                    <div
                      className="flex items-center justify-center rounded font-semibold text-white text-lg"
                      style={{ width: 72, height: 108, background: "var(--color-ink)" }}
                    >
                      {identity.fullName.split(" ").map((p) => p[0]).join("").slice(0, 2)}
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-base font-semibold tracking-tight mb-1" style={{ color: "var(--color-ink)" }}>
                    {identity.fullName}
                  </p>

                  {identity.knownFor.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      <p className="text-[10px] uppercase tracking-wide font-medium" style={{ color: "var(--color-muted)" }}>
                        Known for
                      </p>
                      {identity.knownFor.slice(0, 4).map((k, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs" style={{ color: "var(--color-text)" }}>
                          <span
                            className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-sm font-medium shrink-0"
                            style={{ background: "var(--color-border)", color: "var(--color-muted)" }}
                          >
                            {k.type === "movie" ? "Film" : "TV"}
                          </span>
                          <span className="truncate">{k.title}</span>
                          {k.year && <span className="shrink-0" style={{ color: "var(--color-muted)" }}>{k.year}</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  {identity.popularity != null && identity.popularity > 0 && (
                    <p className="mt-3 text-[10px]" style={{ color: "var(--color-muted)" }}>
                      Industry profile score: {identity.popularity.toFixed(1)}
                    </p>
                  )}

                  {identity.tmdbId && (
                    <p className="mt-2 text-[10px]" style={{ color: "var(--color-muted)" }}>
                      Industry profile linked
                    </p>
                  )}

                  {!identity.tmdbId && (
                    <Link
                      href="/onboarding?update=1"
                      className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium"
                      style={{ color: "var(--color-accent)" }}
                    >
                      Link identity profile
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </Link>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-4">
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                  style={{ background: "var(--color-border)" }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-muted)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>Identity not verified</p>
                  <p className="text-xs mt-0.5 mb-3" style={{ color: "var(--color-muted)" }}>
                    Link your industry profile to enable the Likeness Monitor and talent directory listing.
                  </p>
                  <Link
                    href="/onboarding"
                    className="inline-flex items-center gap-1.5 text-xs font-medium"
                    style={{ color: "var(--color-accent)" }}
                  >
                    Verify my identity
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delegation (talent only) */}
      {user?.role === "talent" && (
        <div className="rounded border p-5 mb-6" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>Delegation</h2>
          <Link
            href="/settings/delegation"
            className="flex items-center justify-between text-sm"
            style={{ color: "var(--color-ink)" }}
          >
            <span>Manage representatives</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-muted)" }}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </Link>
          <p className="mt-1 text-xs" style={{ color: "var(--color-muted)" }}>Grant your agency or manager access to upload and manage your vault.</p>
        </div>
      )}

      {/* Invite Licensee (talent only) */}
      {user?.role === "talent" && (
        <div className="rounded border p-5 mb-6" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "var(--color-muted)" }}>
            Invite a Licensee
          </h2>
          <p className="text-xs mb-4" style={{ color: "var(--color-muted)" }}>
            Send an invitation to a production company so they can access your vault.
          </p>
          <InviteLicensee />
        </div>
      )}

      {/* CAS Bridge (licensee + rep + talent) */}
      {(user?.role === "licensee" || user?.role === "rep" || user?.role === "talent") && (
        <div className="rounded border p-5 mb-6" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>CAS Bridge</h2>
          <Link
            href="/settings/bridge"
            className="flex items-center justify-between text-sm"
            style={{ color: "var(--color-ink)" }}
          >
            <span>{user?.role === "licensee" ? "Manage API tokens & devices" : "View active bridge sessions"}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-muted)" }}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </Link>
          <p className="mt-1 text-xs" style={{ color: "var(--color-muted)" }}>
            {user?.role === "licensee"
              ? "Connect the CAS Bridge app to access licensed scan data in Nuke, Houdini, and Maya."
              : "Monitor when licensees access files via the CAS Bridge desktop app."}
          </p>
        </div>
      )}

      {/* Roster link (rep only) */}
      {user?.role === "rep" && (
        <div className="rounded border p-5 mb-6" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>Talent</h2>
          <Link
            href="/roster"
            className="flex items-center justify-between text-sm"
            style={{ color: "var(--color-ink)" }}
          >
            <span>View my roster</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-muted)" }}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </Link>
        </div>
      )}

      {/* Vault lock (talent only) */}
      {user?.role === "talent" && (
        <div className="rounded border p-5 mb-6" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>
            Vault Lock
          </h2>
          <VaultLockToggle />
        </div>
      )}

      {/* Security */}
      <div className="rounded border p-5 mb-6" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--color-muted)" }}>Security</h2>
        <div className="space-y-3 text-sm" style={{ color: "var(--color-muted)" }}>
          <p>Change password <span className="text-xs">(coming soon)</span></p>
          <p>Regenerate authenticator <span className="text-xs">(coming soon)</span></p>
        </div>
      </div>

      {/* Sign out */}
      <div className="rounded border p-5" style={{ borderColor: "rgba(192,57,43,0.3)", background: "var(--color-surface)" }}>
        <h2 className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--color-danger)" }}>Session</h2>
        <form action="/api/auth/logout" method="POST">
          <button
            type="submit"
            className="flex items-center gap-2 text-sm font-medium"
            style={{ color: "var(--color-danger)" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Sign out of this device
          </button>
        </form>
      </div>
      </>)}
    </div>
  );
}

export const runtime = "edge";

import { cookies } from "next/headers";
import Link from "next/link";

type Role = "talent" | "rep" | "licensee" | "admin";

async function getSessionData(): Promise<{ email: string; role: Role } | null> {
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get("session")?.value;
    if (!session) return null;
    const payload = JSON.parse(atob(session.split(".")[1])) as { email?: string; role?: Role };
    return { email: payload.email ?? "", role: payload.role ?? "talent" };
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

export default async function SettingsPage() {
  const user = await getSessionData();

  return (
    <div className="p-8 max-w-lg">
      <h1 className="text-xl font-semibold mb-1" style={{ color: "var(--color-ink)" }}>Account</h1>
      <p className="text-sm mb-8" style={{ color: "var(--color-muted)" }}>Your account details and preferences.</p>

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
    </div>
  );
}

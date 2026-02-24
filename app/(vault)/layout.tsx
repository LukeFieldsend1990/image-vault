import { cookies } from "next/headers";
import { NavLinks } from "./nav";

type Role = "talent" | "rep" | "licensee" | "admin";

function getRoleFromCookie(): Role {
  try {
    const cookieStore = cookies();
    const session = cookieStore.get("session")?.value;
    if (!session) return "talent";
    const payload = JSON.parse(atob(session.split(".")[1]));
    return (payload.role as Role) ?? "talent";
  } catch {
    return "talent";
  }
}

function getEmailFromCookie(): { email: string; initials: string } {
  try {
    const cookieStore = cookies();
    const session = cookieStore.get("session")?.value;
    if (!session) return { email: "", initials: "??" };
    const payload = JSON.parse(atob(session.split(".")[1]));
    const email = (payload.email as string) ?? "";
    const initials = email
      .split("@")[0]
      .split(/[._-]/)
      .slice(0, 2)
      .map((p: string) => p[0]?.toUpperCase() ?? "")
      .join("") || "??";
    return { email, initials };
  } catch {
    return { email: "", initials: "??" };
  }
}

export default function VaultLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const role = getRoleFromCookie();
  const { email, initials } = getEmailFromCookie();

  return (
    <div className="flex h-screen overflow-hidden">
      {/* ── Sidebar ── */}
      <aside
        className="flex w-56 flex-shrink-0 flex-col justify-between py-8"
        style={{ background: "var(--color-sidebar)", color: "var(--color-sidebar-fg)" }}
      >
        {/* Logo */}
        <div>
          <div className="px-6 mb-10">
            <div className="text-[10px] font-semibold tracking-[0.2em] uppercase" style={{ color: "var(--color-sidebar-muted)" }}>
              United Agents
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className="text-sm font-medium tracking-wide">
                Image Vault
              </div>
            </div>
            <div className="mt-1.5 h-px w-6" style={{ background: "var(--color-accent)" }} />
          </div>

          <NavLinks role={role} />
        </div>

        {/* User */}
        <div className="mx-3 flex items-center gap-3 rounded px-3 py-3 cursor-pointer hover:bg-white/5 transition">
          <div
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
            style={{ background: "var(--color-accent)", color: "#ffffff" }}
          >
            {initials}
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium capitalize" style={{ color: "var(--color-sidebar-fg)" }}>
              {role}
            </p>
            <p className="truncate text-[11px]" style={{ color: "var(--color-sidebar-muted)" }}>
              {email || "—"}
            </p>
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex flex-1 flex-col overflow-y-auto bg-[--color-bg]">
        {children}
      </main>
    </div>
  );
}

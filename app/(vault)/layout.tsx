import { cookies } from "next/headers";
import { NavLinks } from "./nav";
import UserWidget from "./user-widget";

type Role = "talent" | "rep" | "licensee" | "admin";

async function getRoleFromCookie(): Promise<Role> {
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get("session")?.value;
    if (!session) return "talent";
    const payload = JSON.parse(atob(session.split(".")[1])) as { role?: Role };
    return payload.role ?? "talent";
  } catch {
    return "talent";
  }
}

async function getEmailFromCookie(): Promise<{ email: string; initials: string }> {
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get("session")?.value;
    if (!session) return { email: "", initials: "??" };
    const payload = JSON.parse(atob(session.split(".")[1])) as { email?: string };
    const email = payload.email ?? "";
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

export default async function VaultLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const role = await getRoleFromCookie();
  const { email, initials } = await getEmailFromCookie();

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

        <UserWidget email={email} initials={initials} role={role} />
      </aside>

      {/* ── Main ── */}
      <main className="flex flex-1 flex-col overflow-y-auto bg-[--color-bg]">
        {children}
      </main>
    </div>
  );
}

export const runtime = "edge";

import { cookies } from "next/headers";
import { NavLinks } from "./nav";
import UserWidget from "./user-widget";
import { getDb } from "@/lib/db";
import { talentProfiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

type Role = "talent" | "rep" | "licensee" | "admin";

interface SessionData {
  sub: string;
  email: string;
  role: Role;
  initials: string;
}

async function getSessionData(): Promise<SessionData> {
  try {
    const cookieStore = await cookies();
    const session = cookieStore.get("session")?.value;
    if (!session) return { sub: "", email: "", role: "talent", initials: "??" };
    const payload = JSON.parse(atob(session.split(".")[1])) as {
      sub?: string;
      email?: string;
      role?: Role;
    };
    const email = payload.email ?? "";
    const initials =
      email
        .split("@")[0]
        .split(/[._-]/)
        .slice(0, 2)
        .map((p: string) => p[0]?.toUpperCase() ?? "")
        .join("") || "??";
    return { sub: payload.sub ?? "", email, role: payload.role ?? "talent", initials };
  } catch {
    return { sub: "", email: "", role: "talent", initials: "??" };
  }
}

export interface TalentIdentity {
  fullName: string;
  profileImageUrl: string | null;
  tmdbId: number | null;
}

async function getTalentIdentity(userId: string): Promise<TalentIdentity | null> {
  if (!userId) return null;
  try {
    const db = getDb();
    const row = await db
      .select({
        fullName: talentProfiles.fullName,
        profileImageUrl: talentProfiles.profileImageUrl,
        tmdbId: talentProfiles.tmdbId,
      })
      .from(talentProfiles)
      .where(eq(talentProfiles.userId, userId))
      .get();
    return row ?? null;
  } catch {
    return null;
  }
}

export default async function VaultLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { sub, email, role, initials } = await getSessionData();
  const identity = role === "talent" ? await getTalentIdentity(sub) : null;

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

        <UserWidget
          email={email}
          initials={initials}
          role={role}
          identity={identity}
        />
      </aside>

      {/* ── Main ── */}
      <main className="flex flex-1 flex-col overflow-y-auto bg-[--color-bg]">
        {children}
      </main>
    </div>
  );
}

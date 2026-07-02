import { getDb } from "@/lib/db";
import { scanPackages, talentReps } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

type Db = ReturnType<typeof getDb>;

/**
 * Whether a session may manage a scan package's own metadata/tags: the talent who
 * owns it, a rep who actually represents that talent, or a platform admin. Buyers
 * (industry/licensee) are deliberately excluded — they license access, they do not
 * edit a talent's package. Returns the package's talentId when allowed, else null.
 */
export async function resolvePackageOwnerAccess(
  db: Db,
  packageId: string,
  session: { sub: string; role: string },
): Promise<{ talentId: string } | null> {
  const pkg = await db
    .select({ talentId: scanPackages.talentId })
    .from(scanPackages)
    .where(eq(scanPackages.id, packageId))
    .get();
  if (!pkg) return null;

  if (session.role === "admin") return pkg;
  if (session.role === "talent" && pkg.talentId === session.sub) return pkg;
  if (session.role === "rep") {
    const link = await db
      .select({ id: talentReps.id })
      .from(talentReps)
      .where(and(eq(talentReps.repId, session.sub), eq(talentReps.talentId, pkg.talentId)))
      .get();
    if (link) return pkg;
  }
  return null;
}

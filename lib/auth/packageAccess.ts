import { getDb } from "@/lib/db";
import { scanPackages } from "@/lib/db/schema";
import { hasRepAccess } from "@/lib/auth/repAccess";
import type { SessionPayload } from "@/lib/auth/jwt";
import { eq } from "drizzle-orm";

/**
 * Returns true when the session may read or modify a package's metadata:
 * the owning talent, a delegated rep, or an admin. Soft-deleted packages
 * (and unknown ids) are treated as inaccessible.
 */
export async function canAccessPackage(
  session: SessionPayload,
  packageId: string
): Promise<boolean> {
  const db = getDb();
  const pkg = await db
    .select({ talentId: scanPackages.talentId, deletedAt: scanPackages.deletedAt })
    .from(scanPackages)
    .where(eq(scanPackages.id, packageId))
    .get();

  if (!pkg || pkg.deletedAt) return false;
  if (pkg.talentId === session.sub) return true;
  if (session.role === "admin") return true;
  if (session.role === "rep" && (await hasRepAccess(session.sub, pkg.talentId))) {
    return true;
  }
  return false;
}

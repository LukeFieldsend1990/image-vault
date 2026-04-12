export const runtime = "edge";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { scanPackages, talentReps } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import Link from "next/link";
import PackageMetadataForm from "./package-metadata-form";

export default async function PackageMetadataPage({ params }: { params: Promise<{ packageId: string }> }) {
  const { packageId: id } = await params;
  const cookieStore = await cookies();
  const session = cookieStore.get("session")?.value;
  if (!session) redirect("/login");

  let payload: { sub?: string; role?: string; email?: string };
  try {
    payload = JSON.parse(atob(session.split(".")[1]));
  } catch {
    redirect("/login");
  }

  const userId = payload.sub ?? "";
  const role = payload.role ?? "";

  const db = getDb();
  const [pkg] = await db
    .select()
    .from(scanPackages)
    .where(eq(scanPackages.id, id))
    .limit(1)
    .all();

  if (!pkg) redirect("/dashboard");

  // Access check
  if (role === "talent" && pkg.talentId !== userId) redirect("/dashboard");
  if (role === "rep") {
    const [rep] = await db
      .select({ id: talentReps.id })
      .from(talentReps)
      .where(eq(talentReps.repId, userId))
      .all();
    if (!rep) redirect("/dashboard");
  }
  if (role === "licensee") redirect("/dashboard");

  const metadata = {
    id: pkg.id,
    name: pkg.name,
    scanType: pkg.scanType,
    resolution: pkg.resolution,
    polygonCount: pkg.polygonCount,
    colorSpace: pkg.colorSpace,
    hasMesh: pkg.hasMesh ?? false,
    hasTexture: pkg.hasTexture ?? false,
    hasHdr: pkg.hasHdr ?? false,
    hasMotionCapture: pkg.hasMotionCapture ?? false,
    compatibleEngines: pkg.compatibleEngines,
    tags: pkg.tags,
    internalNotes: pkg.internalNotes,
  };

  return (
    <div className="p-8 max-w-2xl">
      <Link href="/dashboard" className="mb-6 inline-flex items-center gap-1.5 text-xs" style={{ color: "var(--color-muted)" }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Back to vault
      </Link>

      <div className="mb-6">
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>Package Metadata</p>
        <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>{pkg.name}</h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          Add technical details and capabilities to help licensees find and evaluate this scan.
        </p>
      </div>

      <PackageMetadataForm metadata={metadata} />
    </div>
  );
}

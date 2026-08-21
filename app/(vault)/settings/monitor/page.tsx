import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { talentProfiles, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { verifySessionJwt } from "@/lib/auth/jwt";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import SetupClient from "./setup-client";

/**
 * Server component: gates the page to talent, fetches the current upload
 * state so the client can render immediately without a spinner on first
 * paint, and passes it to the interactive uploader.
 */
export default async function MonitorSetupPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("session")?.value;
  if (!token) redirect("/login?next=/settings/monitor");

  const { env } = getCloudflareContext();
  const jwtSecret = (env as unknown as { JWT_SECRET?: string }).JWT_SECRET;
  const payload = jwtSecret ? await verifySessionJwt(token, jwtSecret) : null;
  if (!payload) redirect("/login?next=/settings/monitor");
  if (payload.role !== "talent") redirect("/settings");

  const db = getDb();
  const profile = await db
    .select({
      fullName: talentProfiles.fullName,
      agentLetterUploadedAt: talentProfiles.agentLetterUploadedAt,
      idDocumentUploadedAt: talentProfiles.idDocumentUploadedAt,
      enforcementAuthorizationOnFile: talentProfiles.enforcementAuthorizationOnFile,
      authorizationReviewStatus: talentProfiles.authorizationReviewStatus,
    })
    .from(talentProfiles)
    .where(eq(talentProfiles.userId, payload.sub))
    .get();

  if (!profile) redirect("/onboarding");

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 space-y-8">
      <div>
        <Link
          href="/settings"
          className="text-xs font-medium underline underline-offset-2"
          style={{ color: "var(--color-muted)" }}
        >
          ← Settings
        </Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
          Deep Scan — Enforcement Setup
        </h1>
        <p className="mt-2 text-sm" style={{ color: "var(--color-muted)" }}>
          To file takedowns of AI-generated content on your behalf, platforms like Meta need proof
          that ImageVault represents you. Two documents cover it, both stored securely and never
          shown publicly. Until both are on file the &quot;Send report&quot; action is disabled — it
          would be rejected without them.
        </p>
      </div>

      <SetupClient
        initial={{
          fullName: profile.fullName,
          letterUploadedAt: profile.agentLetterUploadedAt,
          idUploadedAt: profile.idDocumentUploadedAt,
          enforcementAuthorizationOnFile: profile.enforcementAuthorizationOnFile,
          reviewStatus: profile.authorizationReviewStatus,
        }}
      />
    </div>
  );
}

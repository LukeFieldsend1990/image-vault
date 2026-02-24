export const runtime = "edge";

import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { users, totpCredentials } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";

// Hardcoded TOTP secret — add this once to your authenticator app.
// Label: "Image Vault (dev)", Issuer: "Image Vault"
// otpauth://totp/Image%20Vault:dev@imagevault.test?secret=JBSWY3DPEHPK3PXP&issuer=Image%20Vault&algorithm=SHA1&digits=6&period=30
const DEV_TOTP_SECRET = "JBSWY3DPEHPK3PXP";
const DEV_PASSWORD = "devpassword1234!";

const PERSONAS = [
  { id: "dev-talent-001", email: "talent@dev.test", role: "talent" as const },
  { id: "dev-rep-001",    email: "rep@dev.test",    role: "rep" as const },
  { id: "dev-licensee-001", email: "licensee@dev.test", role: "licensee" as const },
];

export async function POST() {
  if (process.env.ENVIRONMENT !== "development") {
    return NextResponse.json({ error: "Only available in development" }, { status: 403 });
  }

  const db = getDb();
  const now = new Date();
  const passwordHash = await hashPassword(DEV_PASSWORD);
  const results: string[] = [];

  for (const persona of PERSONAS) {
    // Upsert user (ignore if already exists)
    await db
      .insert(users)
      .values({ id: persona.id, email: persona.email, passwordHash, role: persona.role, createdAt: now })
      .onConflictDoNothing();

    // Upsert TOTP cred — already verified so no setup step needed
    await db
      .insert(totpCredentials)
      .values({ id: `totp-${persona.id}`, userId: persona.id, secret: DEV_TOTP_SECRET, verified: true, createdAt: now })
      .onConflictDoNothing();

    results.push(`${persona.role}: ${persona.email}`);
  }

  return NextResponse.json({
    ok: true,
    password: DEV_PASSWORD,
    totpSecret: DEV_TOTP_SECRET,
    totpUrl: `otpauth://totp/Image%20Vault:dev@imagevault.test?secret=${DEV_TOTP_SECRET}&issuer=Image%20Vault&algorithm=SHA1&digits=6&period=30`,
    accounts: results,
  });
}

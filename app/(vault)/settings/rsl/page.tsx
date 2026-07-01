import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import StandingInstructions from "../standing-instructions";
import RslConsentProfile from "../rsl-consent-profile";
import RslRateCard from "../rsl-rate-card";

async function getRole(): Promise<string | null> {
  try {
    const store = await cookies();
    const session = store.get("session")?.value;
    if (!session) return null;
    const payload = JSON.parse(atob(session.split(".")[1])) as { role?: string };
    return payload.role ?? null;
  } catch {
    return null;
  }
}

// Dedicated page for all AI / likeness licensing (RSL) controls.
export default async function RslSettingsPage() {
  const role = await getRole();
  if (role !== "talent") redirect("/settings");

  return (
    <div className="p-8 max-w-2xl">
      <Link href="/settings" className="mb-6 inline-flex items-center gap-1.5 text-xs" style={{ color: "var(--color-muted)" }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Account settings
      </Link>

      <h1 className="text-xl font-semibold mb-1" style={{ color: "var(--color-ink)" }}>
        RSL — AI Likeness Licensing
      </h1>
      <p className="text-sm mb-8" style={{ color: "var(--color-muted)" }}>
        This is the open <strong>RSL</strong> (Really Simple Licensing) standard + Human Consent Registry — how AI
        systems may use your likeness, and what it costs. It&apos;s <strong>separate from your Image Vault production
        licences</strong> (the scans you license to productions). Set your consent rules, publish your public consent
        profile, link a Human Consent ID, and price AI use. Metered earnings appear in your Royalties dashboard.
      </p>

      <StandingInstructions />
      <RslConsentProfile />
      <RslRateCard />
    </div>
  );
}

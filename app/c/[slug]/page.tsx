import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getProfileBySlug, parseLinks, licenseXmlUrl, olpServerUrl } from "@/lib/rsl/profile";
import { derivePosture, type Light } from "@/lib/rsl/posture";
import { isPublic } from "@/lib/rsl/visibility";

// Unlisted by design — never index a person's consent profile.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const LIGHT: Record<Light, { label: string; colour: string; bg: string; dot: string }> = {
  green: { label: "Permitted", colour: "#166534", bg: "rgba(22,101,52,0.08)", dot: "#16a34a" },
  amber: { label: "Permitted with terms", colour: "#b45309", bg: "rgba(180,83,9,0.08)", dot: "#d97706" },
  red: { label: "Prohibited", colour: "#991b1b", bg: "rgba(153,27,27,0.08)", dot: "#dc2626" },
};

async function load(slug: string) {
  const db = getDb();
  const row = await getProfileBySlug(db, slug);
  if (
    !row ||
    !isPublic({
      publishOptIn: row.profile.publishOptIn,
      adminApproved: row.profile.adminApproved,
      publicSlug: row.profile.publicSlug,
      vaultLocked: row.vaultLocked,
    })
  ) {
    return null;
  }
  const posture = await derivePosture(db, row.profile.talentId);
  return { row, posture };
}

export default async function ConsentProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) notFound();
  const { row, posture } = data;
  const p = row.profile;
  const name = p.displayName || row.fullName || "This person";
  const links = parseLinks(p.linksJson);
  const overall = LIGHT[posture.overall];
  const liveCategories = posture.categories.filter((c) => c.rslUsage !== null);

  return (
    <main
      className="min-h-screen px-5 py-12"
      style={{ background: "var(--color-bg, #fafafa)", color: "var(--color-text, #111)" }}
    >
      {/* React hoists this into <head> — RSL discovery via HTML <link rel="license">. */}
      <link rel="license" type="application/rsl+xml" href={licenseXmlUrl(slug)} />

      <div className="mx-auto" style={{ maxWidth: 640 }}>
        <p className="text-[10px] font-semibold uppercase tracking-widest mb-6" style={{ color: "#c0392b" }}>
          Image Vault · Human Consent
        </p>

        <h1 className="text-2xl font-semibold tracking-tight mb-1">{name}</h1>
        {p.profession && <p className="text-sm mb-5" style={{ color: "#6b7280" }}>{p.profession}</p>}

        {/* Headline stoplight */}
        <div
          className="rounded-lg px-4 py-3 mb-6 flex items-center gap-3"
          style={{ background: overall.bg, border: `1px solid ${overall.colour}33` }}
        >
          <span className="inline-block rounded-full" style={{ width: 12, height: 12, background: overall.dot }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: overall.colour }}>
              AI use: {overall.label}
            </p>
            <p className="text-xs" style={{ color: "#6b7280" }}>
              This person&apos;s stated stance on AI use of their likeness.
            </p>
          </div>
          {p.humanConsentId && (
            <span
              className="ml-auto text-[10px] font-medium px-2 py-1 rounded"
              style={{ background: "rgba(1,180,228,0.12)", color: "#0e7490" }}
              title="Human Consent Registry ID"
            >
              HCR · {p.humanConsentId}
            </span>
          )}
        </div>

        {/* Per-category terms */}
        <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: "#6b7280" }}>
          Specific uses
        </p>
        <div className="space-y-2 mb-7">
          {liveCategories.map((c) => {
            const l = LIGHT[c.light];
            return (
              <div
                key={c.id}
                className="rounded-lg p-3"
                style={{ background: "var(--color-surface, #fff)", border: "1px solid #e5e7eb" }}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-block rounded-full" style={{ width: 9, height: 9, background: l.dot }} />
                  <span className="text-sm font-medium">{c.name}</span>
                  {c.regimeTag && (
                    <span
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                      style={{ background: "#f3f4f6", color: "#6b7280", border: "1px solid #e5e7eb" }}
                    >
                      {c.regimeTag}
                    </span>
                  )}
                  <span className="ml-auto text-[11px] font-medium" style={{ color: l.colour }}>
                    {l.label}
                  </span>
                </div>
                <p className="text-xs mt-1.5" style={{ color: "#6b7280" }}>{c.description}</p>
              </div>
            );
          })}
        </div>

        {/* Licensing CTA */}
        {posture.overall !== "red" && (
          <div
            className="rounded-lg p-4 mb-7"
            style={{ background: "var(--color-surface, #fff)", border: "1px solid #e5e7eb" }}
          >
            <p className="text-sm font-semibold mb-1">Want to license this likeness?</p>
            <p className="text-xs" style={{ color: "#6b7280" }}>
              AI use is licensed through Image Vault on this person&apos;s terms, with dual-custody consent and
              per-use royalties. Machine clients use the Open License Protocol endpoint:
            </p>
            <code className="block text-[11px] mt-2 px-2 py-1.5 rounded break-all" style={{ background: "#f3f4f6", color: "#374151" }}>
              {olpServerUrl()}
            </code>
          </div>
        )}

        {links.length > 0 && (
          <div className="mb-7">
            <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: "#6b7280" }}>
              Verified links
            </p>
            <ul className="space-y-1">
              {links.map((lnk, i) => (
                <li key={i}>
                  <a
                    href={lnk.url}
                    rel="nofollow noopener noreferrer"
                    target="_blank"
                    className="text-xs underline"
                    style={{ color: "#c0392b" }}
                  >
                    {lnk.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="pt-5 mt-2" style={{ borderTop: "1px solid #e5e7eb" }}>
          <a href={licenseXmlUrl(slug)} className="text-[11px] underline" style={{ color: "#6b7280" }}>
            Machine-readable license (RSL)
          </a>
          <p className="text-[11px] mt-2" style={{ color: "#9ca3af" }}>
            Published via Image Vault. Terms are derived from the rights-holder&apos;s standing instructions and
            may change. Anything not explicitly permitted is prohibited.
          </p>
        </div>
      </div>
    </main>
  );
}

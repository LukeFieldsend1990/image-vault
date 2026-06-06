"use client";

import Link from "next/link";
import { FadeImage } from "@/app/(vault)/fade-image";

interface TalentEntry {
  talentId: string;
  fullName: string | null;
  profileImageUrl: string | null;
}

export default function RepCompliancePicker({ roster }: { roster: TalentEntry[] }) {
  const sectionHeader = "text-xs font-medium tracking-widest uppercase";

  return (
    <div className="flex flex-col gap-6 p-8 max-w-2xl mx-auto">
      <div>
        <p className={sectionHeader} style={{ color: "var(--color-muted)" }}>Compliance</p>
        <h1 className="text-xl font-semibold mt-1" style={{ color: "var(--color-ink)" }}>
          Select Talent
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          Choose a talent to view their compliance dashboard.
        </p>
      </div>

      {roster.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          No talent on your roster yet.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {roster.map((t) => (
            <Link
              key={t.talentId}
              href={`/compliance?talentId=${t.talentId}`}
              className="flex items-center gap-4 rounded p-4 transition hover:opacity-80"
              style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
            >
              <div
                className="w-10 h-10 rounded-full overflow-hidden shrink-0 flex items-center justify-center"
                style={{ background: "var(--color-border)" }}
              >
                {t.profileImageUrl ? (
                  <FadeImage
                    src={t.profileImageUrl}
                    alt={t.fullName ?? "Talent"}
                    width={40}
                    height={40}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-xs font-semibold" style={{ color: "var(--color-muted)" }}>
                    {(t.fullName ?? "?").charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <span className="text-sm font-medium" style={{ color: "var(--color-ink)" }}>
                {t.fullName ?? "Unnamed Talent"}
              </span>
              <svg
                className="ml-auto"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ color: "var(--color-muted)" }}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

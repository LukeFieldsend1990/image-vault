import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { CloneRunRecord } from "@/app/api/admin/clone-packages/route";
import CloneClient from "./clone-client";

async function getTodayRecord(): Promise<CloneRunRecord | null> {
  try {
    const kv = getCloudflareContext().env.SESSIONS_KV;
    const today = new Date().toISOString().slice(0, 10);
    const raw = await kv.get(`clone_packages:daily:${today}`);
    return raw ? (JSON.parse(raw) as CloneRunRecord) : null;
  } catch {
    return null;
  }
}

export default async function ClonePackagesPage() {
  await requireAdmin();
  const todayRecord = await getTodayRecord();

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <span
            className="text-[9px] uppercase tracking-[0.2em] font-semibold px-2 py-0.5 rounded"
            style={{ background: "rgba(192,57,43,0.12)", color: "var(--color-accent)" }}
          >
            Admin
          </span>
          <span
            className="text-[9px] uppercase tracking-[0.2em] font-semibold px-2 py-0.5 rounded"
            style={{ background: "rgba(192,57,43,0.18)", color: "var(--color-accent)" }}
          >
            Danger Zone
          </span>
        </div>
        <h1 className="text-xl font-semibold mt-1" style={{ color: "var(--color-ink)" }}>
          Clone Packages
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          Copies all active scan packages, files, and AI tags from one talent account to another.
          R2 objects are physically duplicated — the accounts become fully independent.
        </p>
      </div>

      {/* Risk warning */}
      <div
        className="rounded p-4 mb-6 border"
        style={{ borderColor: "#c0392b", background: "rgba(192,57,43,0.06)" }}
      >
        <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "#c0392b" }}>
          High-risk operation
        </p>
        <ul className="text-sm space-y-1" style={{ color: "var(--color-ink)" }}>
          <li>· This cannot be undone. Cloned packages persist independently on the target account.</li>
          <li>· All admin accounts are notified by email when this runs.</li>
          <li>· Rate-limited to one operation per UTC day.</li>
          <li>· Only completed files are copied — any in-progress uploads on the source are skipped.</li>
        </ul>
      </div>

      <CloneClient todayRecord={todayRecord} />
    </div>
  );
}

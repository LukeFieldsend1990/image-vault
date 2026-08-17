import Link from "next/link";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import ProbeClient from "./probe-client";

export default async function AdminProbePage() {
  await requireAdmin();

  return (
    <div className="mx-auto max-w-4xl px-6 py-10 space-y-8">
      <div>
        <Link
          href="/admin"
          className="text-xs font-medium underline underline-offset-2"
          style={{ color: "var(--color-muted)" }}
        >
          ← Admin
        </Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight" style={{ color: "var(--color-ink)" }}>
          Model probe
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
          Interrogate a generative model for a talent&rsquo;s likeness and produce a sealed, reproducible
          Likeness Encoding Report. A positive result proves the model <em>encodes</em> the identity — not, by
          name-fidelity alone, that it was trained on the vault scans. See{" "}
          <code>docs/training-attribution.md</code> for what a run does and does not establish.
        </p>
      </div>

      <ProbeClient />
    </div>
  );
}

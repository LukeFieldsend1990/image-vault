export const runtime = "edge";

import { requireAdmin } from "@/lib/auth/requireAdmin";
import InviteManager from "./invite-form";

export default async function AdminInvitesPage() {
  await requireAdmin();

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: "var(--color-accent)" }}>Admin</p>
        <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>Invites</h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          Manage platform invitations. Talent and representatives must be invited to join.
        </p>
      </div>

      <InviteManager />
    </div>
  );
}

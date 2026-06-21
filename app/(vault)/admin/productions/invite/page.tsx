import { requireAdmin } from "@/lib/auth/requireAdmin";
import ConciergeClient from "./concierge-client";

// Admin concierge: pre-build a production and invite the industry user, who
// arrives to a mostly-set-up project.
export default async function AdminProductionInvitePage() {
  await requireAdmin();
  return <ConciergeClient />;
}

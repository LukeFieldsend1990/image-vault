export const runtime = "edge";

import { requireAdmin } from "@/lib/auth/requireAdmin";
import BookingsAdminClient from "./bookings-admin-client";

export default async function AdminBookingsPage() {
  await requireAdmin();
  return <BookingsAdminClient />;
}

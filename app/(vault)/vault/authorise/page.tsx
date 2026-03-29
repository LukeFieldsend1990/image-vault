export const runtime = "edge";

import { redirect } from "next/navigation";

// Authorise is now under Licences > Download Requests
export default function AuthorisePage() {
  redirect("/vault/licences");
}

import { redirect } from "next/navigation";

// Organisations moved from Settings to the main navigation (/organisations).
// Keep this route as a permanent redirect for any bookmarked links.
export default function OrganisationSettingsRedirect() {
  redirect("/organisations");
}

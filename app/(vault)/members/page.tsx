export const runtime = "edge";

import MembersClient from "./members-client";

// Union member roster. Access is enforced by the API (platform-wide oversight grant
// or admin); the nav only surfaces this to compliance watchers who hold the grant.
export default function MembersPage() {
  return <MembersClient />;
}

import MembersClient from "./members-client";

// Union member roster — union-owned, one list per union. Access is enforced by the
// API (a union watcher's platform-scoped union grant, or admin); the nav only
// surfaces this to union watchers (a platform-wide regulator has no union list).
export default function MembersPage() {
  return <MembersClient />;
}

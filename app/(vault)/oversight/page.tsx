export const runtime = "edge";

import OversightScorecardClient from "./oversight-scorecard-client";

// Repeat-offender scorecard. Access is enforced by the API (platform-wide oversight
// grant or admin); the nav only surfaces this to compliance watchers who hold the grant.
export default function OversightScorecardPage() {
  return <OversightScorecardClient />;
}

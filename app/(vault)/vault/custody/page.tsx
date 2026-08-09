import LifetimeCustodyClient from "./lifetime-custody-client";

export const metadata = {
  title: "Lifetime custody — ImageVault",
};

// The performer's own view. No talentId — the API defaults to the caller, and
// re-checks entitlement per request rather than trusting the page.
export default function LifetimeCustodyPage() {
  return <LifetimeCustodyClient />;
}

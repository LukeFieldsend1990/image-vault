import WatchlistClient from "./watchlist-client";

// Production watchlist. Access is enforced by the API (platform-wide oversight grant
// or admin); the nav only surfaces this to compliance watchers who hold the grant.
export default function WatchlistPage() {
  return <WatchlistClient />;
}

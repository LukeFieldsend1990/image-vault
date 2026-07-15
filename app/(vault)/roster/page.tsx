import RosterClient from "./roster-client";
import RepReservedRolesBanner from "./rep-reserved-roles-banner";

export default function RosterPage() {
  return (
    <>
      <RepReservedRolesBanner />
      <RosterClient />
    </>
  );
}

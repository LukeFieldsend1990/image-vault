import RosterClient from "./roster-client";
import RepReservedRoles from "./rep-reserved-roles";

export default function RosterPage() {
  return (
    <>
      <RepReservedRoles />
      <RosterClient />
    </>
  );
}

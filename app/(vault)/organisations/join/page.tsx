import { Suspense } from "react";
import JoinClient from "./join-client";

export default function JoinPage() {
  return (
    <Suspense fallback={<div style={{ padding: "2rem", color: "var(--color-muted)", fontSize: "0.875rem" }}>Loading…</div>}>
      <JoinClient />
    </Suspense>
  );
}

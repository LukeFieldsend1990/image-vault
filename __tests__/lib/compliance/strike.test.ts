import { describe, it, expect } from "vitest";
import { mockChainDb } from "../../helpers/mocks";
import { declareStrike, liftStrike } from "@/lib/compliance/strike";
import { findCoveringStrike, assertNoActiveStrike } from "@/lib/compliance/enforce";

const values = (rows: Array<{ values: unknown }>) => rows.map((r) => r.values as any);

describe("declareStrike", () => {
  it("inserts an active strike row + appends a 39.G strike.declared event", async () => {
    const { db, enqueue, insertedRows } = mockChainDb();
    enqueue(null); // appendEvent tip (genesis)

    const { id } = await declareStrike(db as any, {
      scope: "global",
      scopeId: null,
      reason: "SAG-AFTRA strike declared",
      declaredBy: "admin-1",
    });
    expect(id).toBeTruthy();

    const strikeRow = values(insertedRows).find((v) => v.scope === "global");
    expect(strikeRow.status).toBe("active");

    const event = values(insertedRows).find((v) => v.eventType === "strike.declared");
    expect(event.clauseRef).toBe("39.G");
    expect(event.chainKey).toBe(`strike:${id}`);
  });
});

describe("liftStrike", () => {
  it("flips an active strike to lifted + appends strike.lifted", async () => {
    const { db, enqueue, insertedRows, updatedRows } = mockChainDb();
    enqueue({ id: "s1", status: "active" }); // select strike
    enqueue(null); // appendEvent tip

    const ok = await liftStrike(db as any, { id: "s1", liftedBy: "admin-1" });
    expect(ok).toBe(true);

    const update = updatedRows.map((r) => r.set as any).find((s) => s.status === "lifted");
    expect(update).toBeTruthy();
    expect(values(insertedRows).some((v) => v.eventType === "strike.lifted")).toBe(true);
  });

  it("is a no-op on an already-lifted strike", async () => {
    const { db, enqueue } = mockChainDb();
    enqueue({ id: "s1", status: "lifted" });
    expect(await liftStrike(db as any, { id: "s1", liftedBy: "admin-1" })).toBe(false);
  });
});

describe("findCoveringStrike", () => {
  it("returns a covering strike", async () => {
    const { db, enqueue } = mockChainDb();
    enqueue({ organisationId: null, productionId: null }); // licence load
    enqueue({ id: "s1", scope: "global", reason: "strike" }); // strike query
    const block = await findCoveringStrike(db as any, "L1");
    expect(block?.strikeId).toBe("s1");
  });

  it("returns null when no active strike covers the licence", async () => {
    const { db, enqueue } = mockChainDb();
    enqueue({ organisationId: "o1", productionId: null });
    enqueue(undefined);
    expect(await findCoveringStrike(db as any, "L1")).toBeNull();
  });
});

describe("assertNoActiveStrike", () => {
  it("records use.blocked_by_strike and returns the block when locked", async () => {
    const { db, enqueue, insertedRows } = mockChainDb();
    enqueue({ organisationId: null, productionId: null }); // findCoveringStrike licence
    enqueue({ id: "s1", scope: "global", reason: "strike" }); // strike
    enqueue(null); // appendEvent tip

    const block = await assertNoActiveStrike(db as any, { licenceId: "L1", actorId: "src" });
    expect(block?.strikeId).toBe("s1");
    expect(values(insertedRows).some((v) => v.eventType === "use.blocked_by_strike")).toBe(true);
  });

  it("returns null and records nothing when not locked", async () => {
    const { db, enqueue, insertedRows } = mockChainDb();
    enqueue({ organisationId: null, productionId: null });
    enqueue(undefined);
    expect(await assertNoActiveStrike(db as any, { licenceId: "L1" })).toBeNull();
    expect(insertedRows.length).toBe(0);
  });
});

import { describe, it, expect, vi } from "vitest";
import { appendEvent, verifyChain } from "@/lib/compliance/ledger";
import type { HashedEvent } from "@/lib/compliance/types";

/**
 * A DB stub that models the one thing that matters here: the unique index on
 * (chain_key, seq). Inserts land in an in-memory chain; a duplicate seq throws
 * exactly as SQLite would.
 *
 * `failNextInserts` makes the first N inserts collide, standing in for another
 * writer having taken the seq between our tip read and our insert.
 */
function makeChainDb(opts: { failNextInserts?: number; failWith?: string } = {}) {
  const rows: Array<{ chainKey: string; seq: number; hash: string; prevHash: string; eventType: string; payload: unknown }> = [];
  let toFail = opts.failNextInserts ?? 0;
  const inserts: number[] = [];

  const chain = (terminal: () => unknown): unknown =>
    new Proxy(function () {}, {
      get(_t, prop: string) {
        if (prop === "get" || prop === "all") return terminal;
        if (prop === "then") return undefined;
        return () => chain(terminal);
      },
      apply: () => chain(terminal),
    });

  const db = {
    select() {
      // Tip read: highest seq on the chain, or undefined when empty.
      return chain(() => {
        const tip = rows.length ? rows[rows.length - 1] : undefined;
        return tip ? { seq: tip.seq, hash: tip.hash } : undefined;
      });
    },
    insert() {
      return {
        values(v: Record<string, unknown>) {
          inserts.push(v.seq as number);
          if (toFail > 0) {
            toFail -= 1;
            throw new Error(opts.failWith ?? "D1_ERROR: UNIQUE constraint failed: compliance_events.chain_key, compliance_events.seq");
          }
          if (rows.some((r) => r.seq === v.seq)) {
            throw new Error("UNIQUE constraint failed: compliance_events.chain_key, compliance_events.seq");
          }
          rows.push({
            chainKey: v.chainKey as string,
            seq: v.seq as number,
            hash: v.hash as string,
            prevHash: v.prevHash as string,
            eventType: v.eventType as string,
            payload: JSON.parse(v.payloadJson as string),
          });
          return Promise.resolve();
        },
      };
    },
  };

  return { db, rows, inserts };
}

const spec = (eventType: string) => ({
  chainKey: "licence:L1",
  eventType,
  payload: { note: eventType },
});

describe("appendEvent retry on seq collision", () => {
  it("writes at genesis when the chain is empty", async () => {
    const { db, rows } = makeChainDb();
    const ev = await appendEvent(db as never, spec("consent.granted"));
    expect(ev.seq).toBe(0);
    expect(ev.prevHash).toBe("licence:L1");
    expect(rows).toHaveLength(1);
  });

  it("recovers from a racing writer and lands at the next free seq", async () => {
    // First insert collides — as if another request took seq 0 in between.
    const { db, rows, inserts } = makeChainDb({ failNextInserts: 1 });
    const ev = await appendEvent(db as never, spec("consent.granted"));

    expect(inserts.length).toBeGreaterThan(1); // it retried
    expect(ev.seq).toBe(0); // the losing racer's insert failed, chain still empty
    expect(rows).toHaveLength(1);
  });

  it("re-reads the tip on retry so the retried event chains off the new tip", async () => {
    const { db, rows } = makeChainDb();

    // Land a first event normally.
    await appendEvent(db as never, spec("consent.granted"));

    // Now make the next append collide once. If the retry reused the original
    // prevHash instead of re-reading, the chain would fail verification.
    let failed = false;
    const originalInsert = db.insert.bind(db);
    db.insert = () => {
      const built = originalInsert();
      return {
        values(v: Record<string, unknown>) {
          if (!failed) {
            failed = true;
            throw new Error("UNIQUE constraint failed: compliance_events.chain_key, compliance_events.seq");
          }
          return built.values(v);
        },
      };
    };

    await appendEvent(db as never, spec("consent.revoked"));

    const chain: HashedEvent[] = rows.map((r) => ({
      chainKey: r.chainKey,
      seq: r.seq,
      eventType: r.eventType,
      payload: r.payload,
      prevHash: r.prevHash,
      hash: r.hash,
    }));
    expect(chain).toHaveLength(2);
    expect((await verifyChain(chain)).ok).toBe(true);
  });

  it("gives up after a bounded number of attempts rather than looping", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { db, inserts } = makeChainDb({ failNextInserts: 99 });
    await expect(appendEvent(db as never, spec("consent.granted"))).rejects.toThrow(/UNIQUE constraint/i);
    expect(inserts.length).toBeLessThanOrEqual(5);
    vi.useRealTimers();
  });

  it("does not retry an error that is not a seq collision", async () => {
    const { db, inserts } = makeChainDb({ failNextInserts: 1, failWith: "D1_ERROR: no such table: compliance_events" });
    await expect(appendEvent(db as never, spec("consent.granted"))).rejects.toThrow(/no such table/);
    // A schema problem will not fix itself — retrying would only delay the error.
    expect(inserts).toHaveLength(1);
  });
});

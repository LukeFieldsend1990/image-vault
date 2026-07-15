/**
 * Extended mock harness for the full-flow e2e integration test.
 *
 * Same FIFO-queue philosophy as __tests__/helpers/mocks.ts, with three
 * additions the flow test needs:
 *
 *  - DB writes capture the real Drizzle table name (via the drizzle:Name
 *    symbol) and are recorded in one ordered log across inserts + updates,
 *    so the visual report can show exactly which tables each step touched.
 *  - The queue is introspectable (queue.length) so every step can assert it
 *    consumed exactly the reads it enqueued — drift fails loudly.
 *  - sendEmail records outbound mail (recipient + subject) for the report.
 */
import { vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type { SessionPayload } from "@/lib/auth/jwt";

export interface DbWrite {
  op: "insert" | "update";
  table: string;
  values?: unknown; // insert payload
  set?: unknown;    // update payload
}

export interface SentEmail {
  to: string | string[];
  subject: string;
}

const DRIZZLE_NAME = Symbol.for("drizzle:Name");

function tableName(arg: unknown): string {
  const name = (arg as Record<symbol, unknown> | null | undefined)?.[DRIZZLE_NAME];
  return typeof name === "string" ? name : "unknown";
}

function chainDb() {
  const queue: unknown[] = [];
  const writes: DbWrite[] = [];

  function makeChain(table: string): unknown {
    return new Proxy(function () {}, {
      get(_target, prop: string) {
        if (prop === "get") {
          return () => {
            const val = queue.shift();
            return Array.isArray(val) ? val[0] : val;
          };
        }
        if (prop === "all") {
          return () => {
            const val = queue.shift();
            return Array.isArray(val) ? val : val != null ? [val] : [];
          };
        }
        if (prop === "then") return undefined; // never auto-await the proxy
        if (prop === "values") {
          return (v: unknown) => {
            writes.push({ op: "insert", table, values: v });
            return makeChain(table);
          };
        }
        if (prop === "set") {
          return (v: unknown) => {
            writes.push({ op: "update", table, set: v });
            return makeChain(table);
          };
        }
        return () => makeChain(table);
      },
      apply() {
        return makeChain(table);
      },
    });
  }

  const db = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === "then") return undefined;
        return (...args: unknown[]) => makeChain(tableName(args[0]));
      },
    }
  );

  return { db, queue, writes };
}

function memoryKv() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string, format?: string) => {
      const raw = store.get(key) ?? null;
      if (raw && format === "json") {
        try { return JSON.parse(raw); } catch { return null; }
      }
      return raw;
    }),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
    _store: store,
  };
}

export function createE2eEnv() {
  const kv = memoryKv();
  const { db, queue, writes } = chainDb();
  const sentEmails: SentEmail[] = [];
  const currentSession: { value: SessionPayload | null } = { value: null };

  const env = {
    JWT_SECRET: "test-secret",
    SESSIONS_KV: kv,
    DB: {},
    R2_ACCESS_KEY_ID: "test",
    R2_SECRET_ACCESS_KEY: "test",
    CF_ACCOUNT_ID: "test-account",
    R2_BUCKET_NAME: "image-vault-scans",
  };

  const getCloudflareContext = () => ({ env, ctx: { waitUntil: vi.fn() } });
  const getDb = () => db;
  const getKv = () => kv;

  const requireSession = async () => {
    if (!currentSession.value) {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
    }
    return currentSession.value;
  };
  const isErrorResponse = (r: unknown): r is NextResponse => r instanceof NextResponse;

  const sendEmail = vi.fn(async (opts: { to: string | string[]; subject: string }) => {
    sentEmails.push({ to: opts.to, subject: opts.subject });
  });

  return {
    kv,
    db,
    queue,
    writes,
    sentEmails,
    env,
    getCloudflareContext,
    getDb,
    getKv,
    requireSession,
    isErrorResponse,
    sendEmail,
    enqueue(result: unknown) {
      queue.push(result);
    },
    setSession(payload: SessionPayload | null) {
      currentSession.value = payload;
    },
  };
}

/** Flush microtasks + timers so fire-and-forget blocks finish their queue reads. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

export function buildRequest(
  path: string,
  opts?: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  }
): NextRequest {
  const url = new URL(path, "http://localhost:3000");
  const headers = new Headers(opts?.headers);
  if (opts?.body) headers.set("Content-Type", "application/json");
  return new NextRequest(url.toString(), {
    method: opts?.method ?? (opts?.body ? "POST" : "GET"),
    headers,
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
}

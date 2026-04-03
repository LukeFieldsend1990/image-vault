/**
 * Mock harness for domain / route handler tests.
 *
 * Provides:
 *  - mockKv(): in-memory KV store compatible with Cloudflare KV API
 *  - mockChain(): a drizzle-like chainable mock where each .get()/.all() call
 *    pops the next queued result
 *  - mockSession(): vi.fn() replacements for requireSession/isErrorResponse
 *  - helpers to build NextRequest objects for route handlers
 */
import { vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type { SessionPayload } from "@/lib/auth/jwt";

// ─── In-memory KV ────────────────────────────────────────────────────────────

export function mockKv() {
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

// ─── Chainable DB mock ──────────────────────────────────────────────────────

type QueuedResult = unknown;

/**
 * Creates a mock drizzle DB that supports arbitrary chain calls.
 * Terminal methods .get() and .all() dequeue from the results queue in order.
 *
 * Usage:
 *   const { db, enqueue } = mockChainDb();
 *   enqueue(someRow);        // first .get()/.all() returns this
 *   enqueue([row1, row2]);   // second .get()/.all() returns this
 *
 * For insert/update/delete chains that don't call .get()/.all(), the chain
 * still works (returns undefined at terminal).
 */
export function mockChainDb() {
  const queue: QueuedResult[] = [];
  const insertedRows: Array<{ table: string; values: unknown }> = [];
  const updatedRows: Array<{ set: unknown }> = [];
  const deletedRows: Array<{ table: string }> = [];

  function enqueue(result: QueuedResult) {
    queue.push(result);
  }

  function makeChain(): any {
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
        if (prop === "then") return undefined; // prevent auto-awaiting the proxy
        // For values() — record what was inserted
        if (prop === "values") {
          return (v: unknown) => {
            insertedRows.push({ table: "unknown", values: v });
            return makeChain();
          };
        }
        if (prop === "set") {
          return (v: unknown) => {
            updatedRows.push({ set: v });
            return makeChain();
          };
        }
        // All other props return another chainable
        return (..._args: unknown[]) => makeChain();
      },
      apply() {
        return makeChain();
      },
    });
  }

  const db = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === "then") return undefined;
        // select / insert / update / delete all return a new chain
        return (..._args: unknown[]) => makeChain();
      },
    }
  );

  return { db, enqueue, insertedRows, updatedRows, deletedRows };
}

// ─── Request builder ─────────────────────────────────────────────────────────

export function buildRequest(
  path: string,
  opts?: {
    method?: string;
    body?: unknown;
    sessionToken?: string;
    refreshToken?: string;
    headers?: Record<string, string>;
  }
): NextRequest {
  const url = new URL(path, "http://localhost:3000");
  const headers = new Headers(opts?.headers);
  const cookies: string[] = [];
  if (opts?.sessionToken) cookies.push(`session=${opts.sessionToken}`);
  if (opts?.refreshToken) cookies.push(`refresh=${opts.refreshToken}`);
  if (cookies.length) headers.set("Cookie", cookies.join("; "));
  if (opts?.body) headers.set("Content-Type", "application/json");

  return new NextRequest(url.toString(), {
    method: opts?.method ?? (opts?.body ? "POST" : "GET"),
    headers,
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
}

// ─── Response helper ─────────────────────────────────────────────────────────

export async function parseJson(res: NextResponse | Response) {
  return res.json();
}

// ─── Standard mock setup ─────────────────────────────────────────────────────

/**
 * Call this in your test file's vi.mock blocks to wire up the standard mocks.
 * Returns setters so each test can configure DB results and session identity.
 */
export function createTestEnv() {
  const kv = mockKv();
  const { db, enqueue, insertedRows, updatedRows } = mockChainDb();

  const currentSession: { value: SessionPayload | null } = { value: null };

  const env = {
    JWT_SECRET: "test-secret",
    SESSIONS_KV: kv,
    DB: {},
    RESEND_API_KEY: undefined,
    R2_ACCESS_KEY_ID: "test",
    R2_SECRET_ACCESS_KEY: "test",
    CF_ACCOUNT_ID: "test",
  };

  // Module mock implementations
  const getRequestContext = () => ({ env, ctx: { waitUntil: vi.fn() } });
  const getDb = () => db;
  const getKv = () => kv;

  const requireSession = async (req: NextRequest) => {
    if (!currentSession.value) {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
    }
    return currentSession.value;
  };
  const isErrorResponse = (r: any): r is NextResponse => r instanceof NextResponse;

  const sendEmail = vi.fn(async () => {});
  const hasRepAccess = vi.fn(async () => false);

  return {
    kv,
    db,
    enqueue,
    insertedRows,
    updatedRows,
    env,
    getRequestContext,
    getDb,
    getKv,
    requireSession,
    isErrorResponse,
    sendEmail,
    hasRepAccess,
    /** Set current authenticated user for requireSession */
    setSession(payload: SessionPayload | null) {
      currentSession.value = payload;
    },
    /** Clear accumulated state between tests */
    reset() {
      insertedRows.length = 0;
      updatedRows.length = 0;
      kv._store.clear();
      currentSession.value = null;
    },
  };
}

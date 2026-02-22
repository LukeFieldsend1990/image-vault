import { drizzle } from "drizzle-orm/d1";
import { getRequestContext } from "@cloudflare/next-on-pages";
import * as schema from "./schema";

export function getDb() {
  const { env } = getRequestContext();
  return drizzle(env.DB, { schema });
}

export function getKv() {
  const { env } = getRequestContext();
  return env.SESSIONS_KV;
}

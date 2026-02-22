export {};

declare global {
  interface CloudflareEnv {
    DB: D1Database;
    SESSIONS_KV: KVNamespace;
    SCANS_BUCKET: R2Bucket;
    JWT_SECRET: string;
    ENVIRONMENT: string;
    APP_URL: string;
  }
}

/// <reference types="@cloudflare/workers-types" />

export {};

declare global {
  interface CloudflareEnv {
    DB: D1Database;
    SESSIONS_KV: KVNamespace;
    SCANS_BUCKET: R2Bucket;
    PIPELINE_BUCKET: R2Bucket;
    AI: Ai;
    AI_SERVICE: Fetcher;
    AI_CRON_SERVICE: Fetcher;
    VECTORIZE: VectorizeIndex;
    PIPELINE_QUEUE: Queue;
    INBOUND_QUEUE: Queue;
    GEO_FINGERPRINT_QUEUE: Queue;
    PITCH_QUEUE: Queue;
    JWT_SECRET: string;
    ENVIRONMENT: string;
    APP_URL: string;
    ANTHROPIC_API_KEY: string;
  }
}

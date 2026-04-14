export {};

declare global {
  interface CloudflareEnv {
    DB: D1Database;
    SESSIONS_KV: KVNamespace;
    SCANS_BUCKET: R2Bucket;
    AI: Ai;
    AI_SERVICE: Fetcher;
    JWT_SECRET: string;
    ENVIRONMENT: string;
    APP_URL: string;
    ANTHROPIC_API_KEY: string;
    VECTORIZE: VectorizeIndex;
  }
}

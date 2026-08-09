/**
 * Minimal ambient types for `node:sqlite`.
 *
 * The runtime has it (Node 22, behind an experimental flag), but the pinned
 * `@types/node` (v20) predates the module, so TypeScript cannot resolve the
 * import in `scripts/seed-custody-fixture.ts`. Declared narrowly — only the
 * surface the seeder uses — rather than bumping `@types/node`, which would pull
 * a whole Node major's type changes into the app for the sake of one script.
 *
 * Delete this once `@types/node` is on v22 or later.
 */
declare module "node:sqlite" {
  type SqlValue = string | number | bigint | null | Uint8Array;

  class StatementSync {
    run(...params: SqlValue[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: SqlValue[]): Record<string, SqlValue> | undefined;
    all(...params: SqlValue[]): Record<string, SqlValue>[];
  }

  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean });
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}

import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Config for the local fixture seeder only.
 *
 * The seeder is written as a vitest spec so it can import the real
 * `hashEvent`/`canonicalJson` from lib/compliance/ledger and produce ledger
 * chains that genuinely verify. It must NOT run as part of `npm test` — it
 * writes to the local D1 database — so it lives outside the main config's
 * `__tests__/**` include and is reachable only through `npm run seed:custody`.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["scripts/**/seed-*.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});

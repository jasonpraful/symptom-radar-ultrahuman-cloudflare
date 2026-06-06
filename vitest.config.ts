import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // node:sqlite (used by the D1 round-trip + integration tests) is behind a
    // flag on Node 22 and must not be bundled by Vite.
    pool: "forks",
    poolOptions: { forks: { execArgv: ["--experimental-sqlite"] } },
    server: { deps: { external: ["node:sqlite"] } },
  },
  ssr: { external: ["node:sqlite"] },
});

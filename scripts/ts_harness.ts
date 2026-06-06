/**
 * Live smoke test.
 *
 * Drives the REAL Worker code (backfill → daily pipeline → strain) against the
 * live Ultrahuman API using a node:sqlite-backed D1, and prints the resulting
 * snapshots, report, and strain assessment as JSON — handy for verifying a token
 * and eyeballing real output without deploying.
 *
 * Usage:
 *   ULTRAHUMAN_TOKEN=... npm run smoke -- [days]
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeD1 } from "./d1_node.js";
import type { Env } from "../src/env.js";
import { backfill } from "../src/backfill.js";
import { runDailyPipeline } from "../src/report.js";
import { getAll } from "../src/db.js";
import { assessStrain } from "../src/strain.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const token = process.env.ULTRAHUMAN_TOKEN;
  if (!token) throw new Error("ULTRAHUMAN_TOKEN not set");
  const days = parseInt(process.argv[2] ?? "35", 10);

  const migration = join(__dirname, "..", "migrations", "0001_initial_schema.sql");
  const db = makeD1(migration);

  const env: Env = {
    DB: db,
    ULTRAHUMAN_TOKEN: token,
    // no webhook in the harness
    WEBHOOK_FORMAT: "generic",
    NOTIFY_ON_LEVELS: "1,2",
    BACKFILL_DAYS: String(days),
  };

  const bf = await backfill(env, days);
  const daily = await runDailyPipeline(env);
  const snapshots = await getAll(env.DB);
  const strain = assessStrain(snapshots);

  process.stdout.write(
    JSON.stringify(
      {
        backfill: { stored: bf.stored, start: bf.start, end: bf.end, errors: bf.errors },
        daily_date: daily.date,
        report: daily.report,
        strain_full: strain,
        strain_daily: daily.strain,
        snapshots,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

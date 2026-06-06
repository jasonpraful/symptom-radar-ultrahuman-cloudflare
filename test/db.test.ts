import { describe, it, expect, beforeEach } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeD1 } from "./d1_node.js";
import {
  storeSnapshot,
  getRecent,
  getAll,
  getSnapshot,
  countSnapshots,
  logNotification,
  getNotificationLog,
} from "../src/db.js";
import type { Snapshot } from "../src/types.js";

const MIGRATION = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations",
  "0001_initial_schema.sql",
);

function emptySnapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    sleep_score: null, total_sleep_min: null, sleep_efficiency: null,
    deep_sleep_min: null, light_sleep_min: null, rem_sleep_min: null,
    temp_deviation: null, avg_body_temp: null, night_rhr: null, sleep_rhr: null,
    avg_sleep_hrv: null, recovery_index: null, movement_index: null,
    active_minutes: null, inactive_time: null, total_steps: null, vo2_max: null,
    spo2: null, tosses_and_turns: null, full_sleep_cycles: null, restorative_sleep: null,
    ...over,
  };
}

describe("D1 storage (node:sqlite-backed)", () => {
  let db: D1Database;
  beforeEach(() => {
    db = makeD1(MIGRATION);
  });

  it("stores and reads back a snapshot", async () => {
    await storeSnapshot(db, "2026-06-05", emptySnapshot({ sleep_score: 81, night_rhr: 56 }));
    const row = await getSnapshot(db, "2026-06-05");
    expect(row?.sleep_score).toBe(81);
    expect(row?.night_rhr).toBe(56);
    expect(await countSnapshots(db)).toBe(1);
  });

  it("upserts on duplicate date (INSERT OR REPLACE)", async () => {
    await storeSnapshot(db, "2026-06-05", emptySnapshot({ sleep_score: 70 }));
    await storeSnapshot(db, "2026-06-05", emptySnapshot({ sleep_score: 90 }));
    expect(await countSnapshots(db)).toBe(1);
    expect((await getSnapshot(db, "2026-06-05"))?.sleep_score).toBe(90);
  });

  it("getRecent returns the last N rows in ascending date order", async () => {
    for (const d of ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04"]) {
      await storeSnapshot(db, d, emptySnapshot());
    }
    const recent = await getRecent(db, 2);
    expect(recent.map((r) => r.date)).toEqual(["2026-06-03", "2026-06-04"]);
    const all = await getAll(db);
    expect(all.map((r) => r.date)).toEqual([
      "2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04",
    ]);
  });

  it("logs and reads notifications newest-first", async () => {
    await logNotification(db, {
      date: "2026-06-05", strain_level: 2, detail: "x", report: "r",
      channel: "discord", delivered: true,
    });
    const log = await getNotificationLog(db, 10);
    expect(log).toHaveLength(1);
    expect(log[0].strain_level).toBe(2);
    expect(Boolean(log[0].delivered)).toBe(true);
  });
});

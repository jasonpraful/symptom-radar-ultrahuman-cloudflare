import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeD1 } from "./d1_node.js";
import { runDailyPipeline } from "../src/report.js";
import { backfill } from "../src/backfill.js";
import type { Env } from "../src/env.js";
import type { UltrahumanMetric } from "../src/types.js";

const MIGRATION = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations",
  "0001_initial_schema.sql",
);

/** Build a synthetic day's metrics for a given date string. */
function dayMetrics(seed: number): UltrahumanMetric[] {
  return [
    { type: "hr", object: { values: [{ value: 60 + seed }, { value: 80 + seed }] } },
    { type: "hrv", object: { values: [{ value: 40 }, { value: 90 }] } },
    { type: "temp", object: { values: [{ value: 34 }, { value: 36 }] } },
    { type: "steps", object: { values: [{ value: 1000 + seed }, { value: 500 }] } },
    { type: "night_rhr", object: { avg: 55 + (seed % 3), values: [] } },
    { type: "sleep_rhr", object: { value: 55 + (seed % 3) } },
    { type: "avg_sleep_hrv", object: { value: 70 + (seed % 5) } },
    { type: "recovery_index", object: { value: 75 } },
    { type: "movement_index", object: { value: 60 } },
    { type: "active_minutes", object: { value: 10 } },
    { type: "inactive_time", object: { value: 200 } },
    {
      type: "sleep",
      object: {
        sleep_score: { score: 80 + (seed % 4) },
        total_sleep: { minutes: 480 },
        sleep_efficiency: { percentage: 90 },
        deep_sleep: { minutes: 60 },
        light_sleep: { minutes: 300 },
        rem_sleep: { minutes: 120 },
        temperature_deviation: { celsius: (seed % 3) * 0.1 },
        average_body_temperature: { celsius: 35.5 },
        spo2: { value: 98 },
        tosses_and_turns: { count: 5 },
        full_sleep_cycles: { cycles: 4 },
        restorative_sleep: { percentage: 40 },
      },
    },
  ];
}

/** Stub global.fetch to serve synthetic Ultrahuman responses by date. */
function installFetchStub() {
  let seed = 0;
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const metrics: Record<string, UltrahumanMetric[]> = {};
    const dateParam = url.searchParams.get("date");
    if (dateParam) {
      metrics[dateParam] = dayMetrics(seed++);
    } else {
      // range request: fabricate the 7 days the backfill expects in this chunk
      const start = Number(url.searchParams.get("start_epoch"));
      const end = Number(url.searchParams.get("end_epoch"));
      for (let t = start; t < end; t += 86400) {
        const d = new Date(t * 1000).toISOString().slice(0, 10);
        metrics[d] = dayMetrics(seed++);
      }
    }
    return new Response(JSON.stringify({ data: { metrics } }), { status: 200 });
  });
  return spy;
}

describe("end-to-end pipeline (stubbed API + node:sqlite D1)", () => {
  let env: Env;
  beforeEach(() => {
    installFetchStub();
    env = {
      DB: makeD1(MIGRATION),
      ULTRAHUMAN_TOKEN: "test-token",
      WEBHOOK_FORMAT: "generic",
      NOTIFY_ON_LEVELS: "1,2",
      BACKFILL_DAYS: "20",
    };
  });
  afterEach(() => vi.restoreAllMocks());

  it("backfills history then runs the daily pipeline and renders a report", async () => {
    const fixedNow = new Date("2026-06-06T12:00:00Z");
    const bf = await backfill(env, 20, fixedNow);
    expect(bf.stored).toBeGreaterThan(15);
    expect(bf.errors).toEqual([]);

    const result = await runDailyPipeline(env, fixedNow);
    expect(result.date).toBe("2026-06-06");
    expect(result.report).toContain("## 🩸 Ultrahuman Daily");
    expect(result.report).toContain("Symptom Radar");
    expect([0, 1, 2]).toContain(result.strain.level);
    // today's snapshot persisted
    expect(result.snapshot.sleep_score).not.toBeNull();
    expect(result.history.length).toBeGreaterThan(8);
  });
});

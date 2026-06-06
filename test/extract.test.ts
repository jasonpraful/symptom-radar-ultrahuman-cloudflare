import { describe, it, expect } from "vitest";
import {
  extractMetric,
  extractSleepSummary,
  extractStepsTotal,
  buildSnapshotFromMetrics,
} from "../src/extract.js";
import type { UltrahumanMetric } from "../src/types.js";

/** Minimal but schema-accurate sample day (mirrors the real Partner API shape). */
function sampleDay(): UltrahumanMetric[] {
  return [
    { type: "hr", object: { values: [{ value: 60 }, { value: 70 }, { value: 80 }] } },
    { type: "hrv", object: { values: [{ value: 40 }, { value: 60 }] } },
    { type: "temp", object: { values: [{ value: 34.5 }, { value: 36.5 }] } },
    { type: "spo2", object: { values: [{ value: 97 }, { value: 99 }] } },
    { type: "steps", object: { values: [{ value: 100 }, { value: 250 }, { value: 50 }] } },
    { type: "night_rhr", object: { avg: 56, values: [] } },
    { type: "sleep_rhr", object: { value: 55 } },
    { type: "avg_sleep_hrv", object: { value: 76 } },
    { type: "recovery_index", object: { value: 75 } },
    { type: "movement_index", object: { value: 60 } },
    { type: "active_minutes", object: { value: 0 } },
    { type: "inactive_time", object: { value: 245.0 } },
    { type: "vo2_max", object: { value: 48 } },
    {
      type: "sleep",
      object: {
        sleep_score: { score: 81 },
        total_sleep: { minutes: 519 },
        sleep_efficiency: { percentage: 85 },
        deep_sleep: { minutes: 50 },
        light_sleep: { minutes: 329 },
        rem_sleep: { minutes: 140 },
        temperature_deviation: { celsius: 0.35 },
        average_body_temperature: { celsius: 35.81 },
        spo2: { value: null },
        tosses_and_turns: { count: 14 },
        full_sleep_cycles: { cycles: 4 },
        restorative_sleep: { percentage: 31 },
      },
    },
  ];
}

describe("extractMetric", () => {
  const m = sampleDay();

  it("aggregates value-series types to {avg,min,max} with half-even avg", () => {
    expect(extractMetric(m, "hr")).toEqual({ avg: 70, min: 60, max: 80 });
    expect(extractMetric(m, "hrv")).toEqual({ avg: 50, min: 40, max: 60 });
    expect(extractMetric(m, "temp")).toEqual({ avg: 35.5, min: 34.5, max: 36.5 });
  });

  it("reads scalar value types", () => {
    expect(extractMetric(m, "recovery_index")).toEqual({ value: 75 });
    expect(extractMetric(m, "inactive_time")).toEqual({ value: 245.0 });
  });

  it("reads night_rhr.avg and sleep_rhr.value", () => {
    expect(extractMetric(m, "night_rhr")).toEqual({ avg: 56 });
    expect(extractMetric(m, "sleep_rhr")).toEqual({ value: 55 });
  });

  it("returns null for vo2_max (faithful to the original's missing branch)", () => {
    expect(extractMetric(m, "vo2_max")).toBeNull();
  });

  it("returns null for an absent type", () => {
    expect(extractMetric(m, "does_not_exist")).toBeNull();
  });

  it("keeps scanning when a value-series type has no usable values", () => {
    const metrics: UltrahumanMetric[] = [
      { type: "hr", object: { values: [] } },
      { type: "hr", object: { values: [{ value: 65 }] } },
    ];
    expect(extractMetric(metrics, "hr")).toEqual({ avg: 65, min: 65, max: 65 });
  });
});

describe("extractStepsTotal", () => {
  it("sums step values", () => {
    expect(extractStepsTotal(sampleDay())).toBe(400);
  });
  it("returns null when steps absent", () => {
    expect(extractStepsTotal([{ type: "hr", object: { values: [] } }])).toBeNull();
  });
});

describe("extractSleepSummary", () => {
  it("pulls the nested sleep summary fields", () => {
    const sleep = sampleDay().find((x) => x.type === "sleep")!.object!;
    expect(extractSleepSummary(sleep)).toEqual({
      sleep_score: 81,
      total_sleep_min: 519,
      sleep_efficiency: 85,
      deep_sleep_min: 50,
      light_sleep_min: 329,
      rem_sleep_min: 140,
      temp_deviation: 0.35,
      avg_body_temp: 35.81,
      spo2: null,
      tosses_and_turns: 14,
      full_sleep_cycles: 4,
      restorative_sleep: 31,
    });
  });
});

describe("buildSnapshotFromMetrics", () => {
  it("assembles a full snapshot (vo2_max stays null by design)", () => {
    const snap = buildSnapshotFromMetrics(sampleDay());
    expect(snap.sleep_score).toBe(81);
    expect(snap.night_rhr).toBe(56);
    expect(snap.sleep_rhr).toBe(55);
    expect(snap.avg_sleep_hrv).toBe(76);
    expect(snap.temp_deviation).toBe(0.35);
    expect(snap.total_steps).toBe(400);
    expect(snap.vo2_max).toBeNull();
    expect(snap.recovery_index).toBe(75);
  });
});

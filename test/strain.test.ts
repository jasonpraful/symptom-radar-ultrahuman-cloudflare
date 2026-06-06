import { describe, it, expect } from "vitest";
import {
  computeZscore,
  rollingStatsWeighted,
  computeRollingAvg,
  assessStrain,
} from "../src/strain.js";
import type { SnapshotRow } from "../src/types.js";

function snap(overrides: Partial<SnapshotRow>): SnapshotRow {
  return {
    date: "x",
    sleep_score: 80,
    total_sleep_min: null,
    sleep_efficiency: null,
    deep_sleep_min: null,
    light_sleep_min: null,
    rem_sleep_min: null,
    temp_deviation: 0,
    avg_body_temp: null,
    night_rhr: 55,
    sleep_rhr: 55,
    avg_sleep_hrv: 70,
    recovery_index: 75,
    movement_index: null,
    active_minutes: null,
    inactive_time: null,
    total_steps: null,
    vo2_max: null,
    spo2: null,
    tosses_and_turns: null,
    full_sleep_cycles: null,
    restorative_sleep: null,
    ...overrides,
  };
}

describe("computeZscore", () => {
  it("returns null for zero/null std or null value", () => {
    expect(computeZscore(5, 3, 0)).toBeNull();
    expect(computeZscore(5, 3, null)).toBeNull();
    expect(computeZscore(null, 3, 1)).toBeNull();
  });
  it("computes (x-mean)/std", () => {
    expect(computeZscore(5, 3, 2)).toBe(1);
  });
});

describe("rollingStatsWeighted", () => {
  it("returns [null,null] with fewer than 7 valid values", () => {
    expect(rollingStatsWeighted([1, 2, 3, 4, 5, 6])).toEqual([null, null]);
  });
  it("returns [mean,0] for a constant series of 7+", () => {
    const [mean, std] = rollingStatsWeighted(Array(10).fill(50));
    expect(mean).toBeCloseTo(50, 10);
    expect(std).toBeCloseTo(0, 10);
  });
});

describe("computeRollingAvg", () => {
  it("averages the last `window` non-null values", () => {
    expect(computeRollingAvg([1, 2, 3, 4, 5], 3)).toBe(4);
  });
  it("falls back to overall mean when too few values", () => {
    expect(computeRollingAvg([2, 4], 3)).toBe(3);
  });
});

describe("assessStrain", () => {
  it("needs 7+ days of baseline", () => {
    const h = Array.from({ length: 5 }, () => snap({}));
    expect(assessStrain(h).level).toBe(0);
    expect(assessStrain(h).detail).toMatch(/7\+ days/);
  });

  it("reports no signs for steady, varied-but-normal data", () => {
    const h = Array.from({ length: 22 }, (_, i) =>
      snap({ night_rhr: 55 + (i % 3), avg_sleep_hrv: 70 + (i % 4), temp_deviation: (i % 3) * 0.05 }),
    );
    const r = assessStrain(h);
    expect(r.level).toBe(0);
  });

  it("flags major signs when RHR↑, HRV↓, temp↑ and recovery↓ together", () => {
    const baseline = Array.from({ length: 21 }, (_, i) =>
      snap({
        night_rhr: 54 + (i % 3),
        sleep_rhr: 54 + (i % 3),
        avg_sleep_hrv: 68 + (i % 5),
        temp_deviation: (i % 3) * 0.05,
        recovery_index: 74 + (i % 4),
      }),
    );
    const today = snap({
      night_rhr: 80,
      sleep_rhr: 80,
      avg_sleep_hrv: 30,
      temp_deviation: 1.6,
      recovery_index: 40,
    });
    const r = assessStrain([...baseline, today]);
    expect(r.level).toBe(2);
    expect(r.detail).toContain("RHR 80");
    expect(r.detail).toContain("Temp Δ +1.6°C");
    expect(r.detail).toMatch(/Aggregate: \d+\.\d{2}σ/);
  });

  it("returns insufficient-data when every baseline series is constant (std 0)", () => {
    const h = Array.from({ length: 22 }, () => snap({}));
    // all identical → std 0 on every metric → no contributions
    expect(assessStrain(h).detail).toBe("Insufficient data for strain assessment");
  });
});

import type {
  MetricStats,
  Snapshot,
  UltrahumanMetric,
  UltrahumanMetricObject,
} from "./types.js";
import { round1HalfEven } from "./format.js";

/** True for finite numbers (mirrors Python's `isinstance(v, (int, float))` guard). */
function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

const VALUE_SERIES_TYPES = new Set(["hr", "hrv", "steps", "temp", "spo2"]);
const SCALAR_VALUE_TYPES = new Set([
  "recovery_index",
  "movement_index",
  "active_minutes",
  "inactive_time",
  "weekly_active_minutes",
  "movements",
]);

/**
 * Port of Python `extract_metric(metrics, mtype)`.
 *
 * Returns a shape that depends on `mtype`:
 *  - value-series types -> { avg, min, max }
 *  - scalar value types -> { value }
 *  - "night_rhr"        -> { avg }
 *  - "avg_sleep_hrv"    -> { value }
 *  - "sleep_rhr"        -> { value }
 *  - anything else (incl. "vo2_max") -> null  (intentional parity with the original)
 */
export function extractMetric(
  metrics: UltrahumanMetric[],
  mtype: string,
): MetricStats | { value: number | null } | { avg: number | null } | null {
  for (const m of metrics) {
    if (m.type === mtype) {
      const obj: UltrahumanMetricObject = m.object ?? {};
      if (VALUE_SERIES_TYPES.has(mtype)) {
        const vals = (obj.values ?? [])
          .map((v) => v.value)
          .filter(isNum);
        if (vals.length > 0) {
          const avg = round1HalfEven(vals.reduce((a, b) => a + b, 0) / vals.length);
          return { avg, min: Math.min(...vals), max: Math.max(...vals) };
        }
        // Matched type but no usable values: do NOT return — keep scanning for
        // another matching metric, then fall through to `return null` at the end
        // (parity with the Python loop).
      }
      if (SCALAR_VALUE_TYPES.has(mtype)) {
        return { value: obj.value ?? null };
      }
      if (mtype === "night_rhr") {
        return { avg: obj.avg ?? null };
      }
      if (mtype === "avg_sleep_hrv") {
        return { value: obj.value ?? null };
      }
      if (mtype === "sleep_rhr") {
        return { value: obj.value ?? null };
      }
      // Matched type but no handler branch (e.g. "vo2_max"): fall through to keep
      // scanning, exactly like the Python loop, ultimately returning null.
    }
  }
  return null;
}

/** Port of Python `extract_sleep_summary(obj)`. */
export function extractSleepSummary(obj: UltrahumanMetricObject): Partial<Snapshot> {
  return {
    sleep_score: obj.sleep_score?.score ?? null,
    total_sleep_min: obj.total_sleep?.minutes ?? null,
    sleep_efficiency: obj.sleep_efficiency?.percentage ?? null,
    deep_sleep_min: obj.deep_sleep?.minutes ?? null,
    light_sleep_min: obj.light_sleep?.minutes ?? null,
    rem_sleep_min: obj.rem_sleep?.minutes ?? null,
    temp_deviation: obj.temperature_deviation?.celsius ?? null,
    avg_body_temp: obj.average_body_temperature?.celsius ?? null,
    spo2: obj.spo2?.value ?? null,
    tosses_and_turns: obj.tosses_and_turns?.count ?? null,
    full_sleep_cycles: obj.full_sleep_cycles?.cycles ?? null,
    restorative_sleep: obj.restorative_sleep?.percentage ?? null,
  };
}

/** Port of Python `extract_steps_total(metrics)`. */
export function extractStepsTotal(metrics: UltrahumanMetric[]): number | null {
  for (const m of metrics) {
    if (m.type === "steps") {
      const vals = m.object?.values ?? [];
      return vals.reduce((acc, v) => acc + (isNum(v.value) ? v.value : 0), 0);
    }
  }
  return null;
}

/**
 * Build a full Snapshot from a day's metrics array.
 *
 * Mirrors the snapshot-construction block used in Python's `backfill()` (the
 * "pure" path that reads everything from one day's metrics). `build_report`
 * uses a slightly different RHR/steps blend for *today* — see report.ts.
 */
export function buildSnapshotFromMetrics(metrics: UltrahumanMetric[]): Snapshot {
  let sleepRaw: Partial<Snapshot> = {};
  for (const m of metrics) {
    if (m.type === "sleep") {
      sleepRaw = extractSleepSummary(m.object ?? {});
      break;
    }
  }

  const nightRhr = extractMetric(metrics, "night_rhr") as { avg: number | null } | null;
  const sleepRhr = extractMetric(metrics, "sleep_rhr") as { value: number | null } | null;
  const sleepHrv = extractMetric(metrics, "avg_sleep_hrv") as { value: number | null } | null;
  const recovery = extractMetric(metrics, "recovery_index") as { value: number | null } | null;
  const movement = extractMetric(metrics, "movement_index") as { value: number | null } | null;
  const active = extractMetric(metrics, "active_minutes") as { value: number | null } | null;
  const inactive = extractMetric(metrics, "inactive_time") as { value: number | null } | null;
  const vo2 = extractMetric(metrics, "vo2_max") as { value: number | null } | null;

  return {
    sleep_score: sleepRaw.sleep_score ?? null,
    total_sleep_min: sleepRaw.total_sleep_min ?? null,
    sleep_efficiency: sleepRaw.sleep_efficiency ?? null,
    deep_sleep_min: sleepRaw.deep_sleep_min ?? null,
    light_sleep_min: sleepRaw.light_sleep_min ?? null,
    rem_sleep_min: sleepRaw.rem_sleep_min ?? null,
    temp_deviation: sleepRaw.temp_deviation ?? null,
    avg_body_temp: sleepRaw.avg_body_temp ?? null,
    night_rhr: nightRhr?.avg ?? null,
    sleep_rhr: sleepRhr?.value ?? null,
    avg_sleep_hrv: sleepHrv?.value ?? null,
    recovery_index: recovery?.value ?? null,
    movement_index: movement?.value ?? null,
    active_minutes: active?.value ?? null,
    inactive_time: inactive?.value ?? null,
    total_steps: extractStepsTotal(metrics),
    vo2_max: vo2?.value ?? null,
    spo2: sleepRaw.spo2 ?? null,
    tosses_and_turns: sleepRaw.tosses_and_turns ?? null,
    full_sleep_cycles: sleepRaw.full_sleep_cycles ?? null,
    restorative_sleep: sleepRaw.restorative_sleep ?? null,
  };
}

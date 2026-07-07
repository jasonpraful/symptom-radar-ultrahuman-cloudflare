// ─── Ultrahuman Partner API shapes ─────────────────────────────────────────────
// These are intentionally loose — the API returns a heterogeneous `metrics` array
// keyed by date. We mirror the Python `.get(...)` defensiveness with optional types.

export interface UltrahumanValue {
  value?: number | null;
  timestamp?: number;
}

export interface UltrahumanMetricObject {
  value?: number | null;
  avg?: number | null;
  values?: UltrahumanValue[];
  // Sleep summary sub-objects (each is `{ <unit>: number }`)
  sleep_score?: { score?: number | null } | null;
  total_sleep?: { minutes?: number | null } | null;
  sleep_efficiency?: { percentage?: number | null } | null;
  deep_sleep?: { minutes?: number | null } | null;
  light_sleep?: { minutes?: number | null } | null;
  rem_sleep?: { minutes?: number | null } | null;
  temperature_deviation?: { celsius?: number | null } | null;
  average_body_temperature?: { celsius?: number | null } | null;
  spo2?: { value?: number | null } | null;
  tosses_and_turns?: { count?: number | null } | null;
  full_sleep_cycles?: { cycles?: number | null } | null;
  restorative_sleep?: { percentage?: number | null } | null;
  [key: string]: unknown;
}

export interface UltrahumanMetric {
  type?: string;
  object?: UltrahumanMetricObject;
}

export interface UltrahumanResponse {
  data?: {
    // Live Partner API (`/api/v1/metrics?email=&date=`) returns a flat array of
    // metrics for the single requested day.
    metric_data?: UltrahumanMetric[];
    // Legacy shape: a date-keyed map of metric arrays (kept for test fixtures /
    // backward compatibility). `metricsFor()` in ultrahuman.ts reads either.
    metrics?: Record<string, UltrahumanMetric[]>;
    latest_time_zone?: string;
  };
}

// ─── Domain models ──────────────────────────────────────────────────────────────

/** A single day's stored biometrics — mirrors the `daily_snapshots` columns. */
export interface Snapshot {
  sleep_score: number | null;
  total_sleep_min: number | null;
  sleep_efficiency: number | null;
  deep_sleep_min: number | null;
  light_sleep_min: number | null;
  rem_sleep_min: number | null;
  temp_deviation: number | null;
  avg_body_temp: number | null;
  night_rhr: number | null;
  sleep_rhr: number | null;
  avg_sleep_hrv: number | null;
  recovery_index: number | null;
  movement_index: number | null;
  active_minutes: number | null;
  inactive_time: number | null;
  total_steps: number | null;
  vo2_max: number | null;
  spo2: number | null;
  tosses_and_turns: number | null;
  full_sleep_cycles: number | null;
  restorative_sleep: number | null;
  weekly_active_minutes: number | null;
  movements: number | null;
  morning_alertness: number | null;
  avg_glucose: number | null;
  glucose_variability: number | null;
  metabolic_score: number | null;
  hba1c: number | null;
  time_in_target: number | null;
}

/** A snapshot row as read back from D1 (includes the date key + created_at). */
export interface SnapshotRow extends Snapshot {
  date: string;
  created_at?: string;
}

export type StrainLevel = 0 | 1 | 2;

export interface StrainResult {
  level: StrainLevel;
  detail: string;
}

/** Aggregated metric stats {avg,min,max} for the `values[]` metric types. */
export interface MetricStats {
  avg: number;
  min: number;
  max: number;
}

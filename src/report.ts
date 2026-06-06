import type { Env } from "./env.js";
import {
  extractMetric,
  extractSleepSummary,
  extractStepsTotal,
} from "./extract.js";
import { storeSnapshot, getRecent } from "./db.js";
import { fetchDay } from "./ultrahuman.js";
import { assessStrain } from "./strain.js";
import type {
  MetricStats,
  Snapshot,
  SnapshotRow,
  StrainResult,
  UltrahumanMetric,
} from "./types.js";
import { signed1 } from "./format.js";

const STRAIN_ICONS: Record<number, string> = {
  0: "✅ No signs",
  1: "⚠️ Minor signs",
  2: "🔴 Major signs",
};

/** Port of `format_display(val, suffix)`. */
function fmt(val: number | string | null | undefined, suffix = ""): string {
  return val === null || val === undefined ? "—" : `${val}${suffix}`;
}

/** UTC YYYY-MM-DD for a Date. */
export function utcDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface DailyResult {
  date: string;
  snapshot: Snapshot;
  strain: StrainResult;
  report: string;
  history: SnapshotRow[];
}

/**
 * Port of Python `build_report()` — fetch yesterday + today, store today's
 * snapshot, assess strain over the recent history, and render the markdown report.
 *
 * `now` is injectable for testing/backfill-of-a-specific-day; defaults to now.
 */
export async function runDailyPipeline(
  env: Env,
  now: Date = new Date(),
): Promise<DailyResult> {
  const token = env.ULTRAHUMAN_TOKEN;
  const yesterday = new Date(now.getTime() - 24 * 3600 * 1000);
  const yStr = utcDateStr(yesterday);
  const tStr = utcDateStr(now);

  const [yData, tData] = await Promise.all([
    fetchDay(token, yStr),
    fetchDay(token, tStr),
  ]);

  const yMetrics: UltrahumanMetric[] = yData.data?.metrics?.[yStr] ?? [];
  const tMetrics: UltrahumanMetric[] = tData.data?.metrics?.[tStr] ?? [];

  // Today's sleep summary
  let sleepRaw: Partial<Snapshot> | null = null;
  for (const m of tMetrics) {
    if (m.type === "sleep") {
      sleepRaw = extractSleepSummary(m.object ?? {});
      break;
    }
  }

  const tNightRhr = extractMetric(tMetrics, "night_rhr") as { avg: number | null } | null;
  const tSleepRhr = extractMetric(tMetrics, "sleep_rhr") as { value: number | null } | null;
  const tSleepHrv = extractMetric(tMetrics, "avg_sleep_hrv") as { value: number | null } | null;
  const tRecovery = extractMetric(tMetrics, "recovery_index") as { value: number | null } | null;
  const tMovement = extractMetric(tMetrics, "movement_index") as { value: number | null } | null;
  const tActive = extractMetric(tMetrics, "active_minutes") as { value: number | null } | null;
  const tInactive = extractMetric(tMetrics, "inactive_time") as { value: number | null } | null;
  const tVo2 = extractMetric(tMetrics, "vo2_max") as { value: number | null } | null;
  const tHr = extractMetric(tMetrics, "hr") as MetricStats | null;
  const tHrv = extractMetric(tMetrics, "hrv") as MetricStats | null;
  const tTemp = extractMetric(tMetrics, "temp") as MetricStats | null;
  const ySteps = extractStepsTotal(yMetrics);

  // `(sleep_rhr.value) or (night_rhr.avg)` — Python truthiness (0 falls through).
  const rhrVal = (tSleepRhr?.value || tNightRhr?.avg) ?? null;
  const hrvVal = tSleepHrv?.value ?? null;

  const snapshot: Snapshot = {
    sleep_score: sleepRaw?.sleep_score ?? null,
    total_sleep_min: sleepRaw?.total_sleep_min ?? null,
    sleep_efficiency: sleepRaw?.sleep_efficiency ?? null,
    deep_sleep_min: sleepRaw?.deep_sleep_min ?? null,
    light_sleep_min: sleepRaw?.light_sleep_min ?? null,
    rem_sleep_min: sleepRaw?.rem_sleep_min ?? null,
    temp_deviation: sleepRaw?.temp_deviation ?? null,
    avg_body_temp: sleepRaw?.avg_body_temp ?? null,
    night_rhr: tNightRhr ? (tNightRhr.avg ?? null) : null,
    sleep_rhr: tSleepRhr ? (tSleepRhr.value ?? null) : null,
    avg_sleep_hrv: hrvVal,
    recovery_index: tRecovery?.value ?? null,
    movement_index: tMovement?.value ?? null,
    active_minutes: tActive?.value ?? null,
    inactive_time: tInactive?.value ?? null,
    total_steps: ySteps, // NB: yesterday's steps, matching the original
    vo2_max: tVo2?.value ?? null,
    spo2: sleepRaw?.spo2 ?? null,
    tosses_and_turns: sleepRaw?.tosses_and_turns ?? null,
    full_sleep_cycles: sleepRaw?.full_sleep_cycles ?? null,
    restorative_sleep: sleepRaw?.restorative_sleep ?? null,
  };

  await storeSnapshot(env.DB, tStr, snapshot);

  const history = await getRecent(env.DB, 30);
  const strain = assessStrain(history);

  const report = formatReport({
    strain,
    sleepRaw,
    rhrVal,
    hrvVal,
    tRecovery,
    tMovement,
    tActive,
    tInactive,
    tVo2,
    tHr,
    tHrv,
    tTemp,
    ySteps,
    history,
  });

  return { date: tStr, snapshot, strain, report, history };
}

interface FormatArgs {
  strain: StrainResult;
  sleepRaw: Partial<Snapshot> | null;
  rhrVal: number | null;
  hrvVal: number | null;
  tRecovery: { value: number | null } | null;
  tMovement: { value: number | null } | null;
  tActive: { value: number | null } | null;
  tInactive: { value: number | null } | null;
  tVo2: { value: number | null } | null;
  tHr: MetricStats | null;
  tHrv: MetricStats | null;
  tTemp: MetricStats | null;
  ySteps: number | null;
  history: SnapshotRow[];
}

/** Port of the report-string assembly in `build_report()`. */
export function formatReport(a: FormatArgs): string {
  const { strain } = a;
  const parts: string[] = ["## 🩸 Ultrahuman Daily"];

  // Symptom Radar (top)
  parts.push(`\n**🦠 Symptom Radar**`);
  parts.push(`**${STRAIN_ICONS[strain.level]}**`);
  if (strain.level > 0) parts.push(`\`${strain.detail}\``);
  if (strain.level === 1) {
    parts.push("🟡 *Slight deviations — worth watching today*");
  } else if (strain.level === 2) {
    parts.push("🔴 *Significant strain detected — prioritize rest and recovery*");
  } else if (
    strain.level === 0 &&
    strain.detail !== "Insufficient data for strain assessment"
  ) {
    parts.push("🟢 *Biometrics within normal range*");
  }
  parts.push("");

  // Sleep
  if (a.sleepRaw) {
    const s = a.sleepRaw;
    const score = fmt(s.sleep_score ?? null);
    const total = fmt(s.total_sleep_min ?? null, " min");
    const eff = fmt(s.sleep_efficiency ?? null, "%");
    const deep = fmt(s.deep_sleep_min ?? null, " min");
    const light = fmt(s.light_sleep_min ?? null, " min");
    const rem = fmt(s.rem_sleep_min ?? null, " min");
    const tempDev = s.temp_deviation ?? null;
    const tempStr = tempDev !== null ? `${signed1(tempDev)}°C` : "—";
    const avgTemp = fmt(s.avg_body_temp ?? null, "°C");
    const spo2 = fmt(s.spo2 ?? null, "%");
    const tosses = fmt(s.tosses_and_turns ?? null);
    const cycles = fmt(s.full_sleep_cycles ?? null);
    const restor = fmt(s.restorative_sleep ?? null, "%");
    const rhrDisplay = fmt(a.rhrVal, " bpm");

    parts.push("\n**😴 Sleep**");
    parts.push(`Score: **${score}/100** | Total: **${total}** | Eff: **${eff}**`);
    parts.push(`Deep: **${deep}** | Light: **${light}** | REM: **${rem}**`);
    parts.push(`Cycles: **${cycles}** | Restorative: **${restor}**`);
    parts.push(`Sleep HRV: **${a.hrvVal === null ? "None" : a.hrvVal}** | RHR: **${rhrDisplay}**`);
    parts.push(`Body Temp: **${avgTemp}** (Δ${tempStr})`);
    parts.push(`SPO2: **${spo2}** | Tosses: ${tosses}`);
  }

  // Recovery & Activity
  parts.push("\n**💪 Recovery & Activity**");
  const rec = fmt(a.tRecovery?.value ?? null);
  const mov = fmt(a.tMovement?.value ?? null);
  const act = fmt(a.tActive?.value ?? null);
  const ict = fmt(a.tInactive?.value ?? null);
  parts.push(`Recovery: **${rec}/100** | Movement: **${mov}/100**`);
  parts.push(`Active: **${act} min** | Inactive: **${ict} min**`);
  if (a.ySteps) parts.push(`Total Steps: **${Math.trunc(a.ySteps)}**`);
  const vo2 = fmt(a.tVo2?.value ?? null);
  if (a.tVo2?.value) parts.push(`VO2 Max: **${vo2}**`);

  // Vitals
  parts.push("\n**❤️ Vitals**");
  if (a.tHr) parts.push(`HR: avg **${a.tHr.avg}** bpm (${a.tHr.min}–${a.tHr.max})`);
  if (a.tHrv) parts.push(`HRV: avg **${a.tHrv.avg}** ms (${a.tHrv.min}–${a.tHrv.max})`);
  if (a.tTemp) parts.push(`Skin Temp: avg **${a.tTemp.avg}**°C (${a.tTemp.min}–${a.tTemp.max})`);

  const historyCount = a.history.filter((d) => d.sleep_score !== null && d.sleep_score !== undefined).length;
  parts.push(`\n📊 *Baseline: ${historyCount} days of data*`);

  return parts.filter((p) => p).join("\n");
}

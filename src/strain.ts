import type { SnapshotRow, StrainLevel, StrainResult } from "./types.js";
import { signed1 } from "./format.js";

/**
 * Strain detection — a faithful TypeScript port of the Python `assess_strain`
 * pipeline. The maths (weighted z-scores, exponential decay, 3-day trend blend,
 * recovery modifier, thresholds) is preserved exactly so the Cloudflare stack
 * produces the same strain levels as the original for identical input history.
 */

/** Port of `compute_zscore`. Returns null when undefined (mirrors Python None). */
export function computeZscore(
  val: number | null,
  mean: number | null,
  std: number | null,
): number | null {
  if (std === null || std === 0 || val === null) return null;
  return (val - (mean as number)) / std;
}

/**
 * Port of `rolling_stats_weighted` — exponential-decay weighted mean & std.
 * Returns [null, null] when fewer than 7 non-null values are present.
 */
export function rollingStatsWeighted(
  series: (number | null)[],
  decay = 0.9,
): [number | null, number | null] {
  const valid = series.filter((s): s is number => s !== null);
  if (valid.length < 7) return [null, null];

  const n = valid.length;
  const weights = valid.map((_, i) => decay ** (n - 1 - i));
  const totalW = weights.reduce((a, b) => a + b, 0);

  const m =
    weights.reduce((acc, w, i) => acc + w * valid[i], 0) / totalW;
  const variance =
    weights.reduce((acc, w, i) => acc + w * (valid[i] - m) ** 2, 0) / totalW;
  return [m, Math.sqrt(variance)];
}

/** Port of `compute_rolling_avg` — mean of last `window` non-null values. */
export function computeRollingAvg(
  series: (number | null)[],
  window = 3,
): number | null {
  const valid = series.filter((s): s is number => s !== null);
  if (valid.length < window) {
    if (valid.length < 2) return valid.length ? valid[valid.length - 1] : null;
    return valid.reduce((a, b) => a + b, 0) / valid.length;
  }
  const last = valid.slice(valid.length - window);
  return last.reduce((a, b) => a + b, 0) / window;
}

/** `night_rhr or sleep_rhr` with Python truthiness (0 and null both fall through). */
function rhrOf(d: Partial<SnapshotRow>): number | null {
  return (d.night_rhr || d.sleep_rhr) ?? null;
}

/**
 * Port of `assess_strain(history)`.
 * @param history snapshots in ascending date order (oldest first, newest last).
 */
export function assessStrain(history: SnapshotRow[]): StrainResult {
  if (history.length < 8) {
    return { level: 0, detail: "Need 7+ days of data for baseline" };
  }

  let baseline = history.slice(0, -1);
  if (baseline.length > 21) baseline = baseline.slice(baseline.length - 21);

  const today = history[history.length - 1];

  // ── Extract series ──
  const rhrSeries = baseline.map(rhrOf);
  const hrvSeries = baseline.map((d) => d.avg_sleep_hrv ?? null);
  const tempSeries = baseline.map((d) => d.temp_deviation ?? null);
  const recSeries = baseline.map((d) => d.recovery_index ?? null);

  const todayRhr = rhrOf(today);
  const todayHrv = today.avg_sleep_hrv ?? null;
  const todayTemp = today.temp_deviation ?? null;
  const todayRec = today.recovery_index ?? null;

  // ── Baseline stats (weighted) ──
  const [rhrMean, rhrStd] = rollingStatsWeighted(rhrSeries);
  const [hrvMean, hrvStd] = rollingStatsWeighted(hrvSeries);
  const [tempMean, tempStd] = rollingStatsWeighted(tempSeries);
  const [recMean, recStd] = rollingStatsWeighted(recSeries);

  const scores: Record<string, number> = {};
  const contributions: string[] = [];

  // ── Helper: blended score (50% single-day / 50% 3-day trend, trend as boost) ──
  function metricScore(
    currentVal: number | null,
    seriesList: (number | null)[],
    mean: number | null,
    std: number | null,
    weight: number,
    inverted = false,
  ): number {
    if (mean === null || std === null || currentVal === null) return 0;

    const zRaw = computeZscore(currentVal, mean, std);
    if (zRaw === null) return 0;

    const seriesWithToday = [...seriesList, currentVal];
    const trendVal = computeRollingAvg(seriesWithToday, 3);
    const zTrend = computeZscore(trendVal, mean, std);

    // Python: `z_blended = max(z_raw, z_trend or z_raw)` — `or` treats 0/None as falsy.
    const zTrendOr = zTrend === null || zTrend === 0 ? zRaw : zTrend;
    let zBlended = Math.max(zRaw, zTrendOr);

    if (inverted) zBlended = -zBlended;
    if (zBlended <= 0) return 0;

    return zBlended * weight;
  }

  // 1. Resting HR (elevated = strain)
  const rhrScore = metricScore(todayRhr, rhrSeries, rhrMean, rhrStd, 0.25, false);
  if (rhrScore > 0) {
    scores.rhr = rhrScore;
    contributions.push(`RHR ${todayRhr} bpm`);
  }

  // 2. HRV (depressed = strain)
  const hrvScore = metricScore(todayHrv, hrvSeries, hrvMean, hrvStd, 0.25, true);
  if (hrvScore > 0) {
    scores.hrv = hrvScore;
    contributions.push(`HRV ${todayHrv} ms`);
  }

  // 3. Temperature deviation (elevated = strain)
  const tempScore = metricScore(todayTemp, tempSeries, tempMean, tempStd, 0.35, false);
  if (tempScore > 0) {
    scores.temp = tempScore;
    contributions.push(`Temp Δ ${signed1(todayTemp as number)}°C`);
  }

  // 4. Recovery index modifier (depressed = strain)
  if (recMean !== null && recStd !== null && todayRec !== null) {
    const zRec = computeZscore(todayRec, recMean, recStd);
    if (zRec !== null && zRec < -1.0) {
      scores.recovery_mod = Math.min(Math.abs(zRec) * 0.1, 0.4);
      contributions.push(`Recovery ${todayRec} (-${Math.abs(zRec).toFixed(1)}σ)`);
    }
  }

  if (Object.keys(scores).length === 0) {
    return { level: 0, detail: "Insufficient data for strain assessment" };
  }

  const strain = Object.values(scores).reduce((a, b) => a + b, 0);
  let detail = contributions.join(" | ");
  detail += `\nAggregate: ${strain.toFixed(2)}σ`;

  let level: StrainLevel;
  if (strain >= 3.0) level = 2;
  else if (strain >= 1.5) level = 1;
  else level = 0;

  return { level, detail };
}

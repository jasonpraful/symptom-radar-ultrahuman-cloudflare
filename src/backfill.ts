import type { Env } from "./env.js";
import { buildSnapshotFromMetrics } from "./extract.js";
import { storeSnapshot } from "./db.js";
import { fetchRange } from "./ultrahuman.js";
import { utcDateStr } from "./report.js";
import type { UltrahumanMetric } from "./types.js";

const DAY_MS = 24 * 3600 * 1000;

export interface BackfillResult {
  days: number;
  stored: number;
  start: string;
  end: string;
  errors: string[];
}

/**
 * Port of Python `backfill(days)` — seeds the baseline by fetching history in
 * 7-day chunks via the range endpoint, storing each day's snapshot.
 */
export async function backfill(
  env: Env,
  days = 35,
  now: Date = new Date(),
): Promise<BackfillResult> {
  const token = env.ULTRAHUMAN_TOKEN;
  const start = new Date(now.getTime() - days * DAY_MS);
  const end = new Date(now.getTime() - DAY_MS);
  const errors: string[] = [];
  let stored = 0;

  let current = start;
  while (current.getTime() <= end.getTime()) {
    const chunkEnd = new Date(Math.min(current.getTime() + 6 * DAY_MS, end.getTime()));
    const sEpoch = Math.trunc(current.getTime() / 1000);
    const eEpoch = Math.trunc((chunkEnd.getTime() + DAY_MS) / 1000);

    let metricsByDate: Record<string, UltrahumanMetric[]> = {};
    try {
      const data = await fetchRange(token, sEpoch, eEpoch);
      metricsByDate = data.data?.metrics ?? {};
    } catch (err) {
      errors.push(
        `${utcDateStr(current)}–${utcDateStr(chunkEnd)}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      current = new Date(chunkEnd.getTime() + DAY_MS);
      continue;
    }

    let day = current;
    while (day.getTime() <= chunkEnd.getTime()) {
      const dStr = utcDateStr(day);
      const metrics = metricsByDate[dStr] ?? [];
      if (metrics.length > 0) {
        await storeSnapshot(env.DB, dStr, buildSnapshotFromMetrics(metrics));
        stored += 1;
      }
      day = new Date(day.getTime() + DAY_MS);
    }

    current = new Date(chunkEnd.getTime() + DAY_MS);
  }

  return {
    days,
    stored,
    start: utcDateStr(start),
    end: utcDateStr(end),
    errors,
  };
}

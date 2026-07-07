import type { Env } from "./env.js";
import { buildSnapshotFromMetrics } from "./extract.js";
import { storeSnapshot } from "./db.js";
import { fetchDay, metricsFor } from "./ultrahuman.js";
import { utcDateStr } from "./report.js";

const DAY_MS = 24 * 3600 * 1000;

export interface BackfillResult {
  days: number;
  stored: number;
  start: string;
  end: string;
  errors: string[];
}

/**
 * Seed the baseline by fetching history one day at a time (the live Partner API
 * serves a single `date` per request — there is no range endpoint), storing
 * each day's snapshot.
 */
export async function backfill(
  env: Env,
  days = 35,
  now: Date = new Date(),
): Promise<BackfillResult> {
  const token = env.ULTRAHUMAN_TOKEN;
  const email = env.ULTRAHUMAN_EMAIL;
  const start = new Date(now.getTime() - days * DAY_MS);
  const end = new Date(now.getTime() - DAY_MS);
  const errors: string[] = [];
  let stored = 0;

  let day = start;
  while (day.getTime() <= end.getTime()) {
    const dStr = utcDateStr(day);
    try {
      const data = await fetchDay(token, email, dStr);
      const metrics = metricsFor(data, dStr);
      if (metrics.length > 0) {
        await storeSnapshot(env.DB, dStr, buildSnapshotFromMetrics(metrics));
        stored += 1;
      }
    } catch (err) {
      errors.push(
        `${dStr}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    day = new Date(day.getTime() + DAY_MS);
  }

  return {
    days,
    stored,
    start: utcDateStr(start),
    end: utcDateStr(end),
    errors,
  };
}

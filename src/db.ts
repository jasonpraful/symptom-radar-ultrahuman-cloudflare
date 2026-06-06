import type { Snapshot, SnapshotRow } from "./types.js";

const SNAPSHOT_COLUMNS = [
  "sleep_score",
  "total_sleep_min",
  "sleep_efficiency",
  "deep_sleep_min",
  "light_sleep_min",
  "rem_sleep_min",
  "temp_deviation",
  "avg_body_temp",
  "night_rhr",
  "sleep_rhr",
  "avg_sleep_hrv",
  "recovery_index",
  "movement_index",
  "active_minutes",
  "inactive_time",
  "total_steps",
  "vo2_max",
  "spo2",
  "tosses_and_turns",
  "full_sleep_cycles",
  "restorative_sleep",
] as const;

/**
 * Port of Python `store_snapshot` — `INSERT OR REPLACE` keyed on date.
 */
export async function storeSnapshot(
  db: D1Database,
  dateStr: string,
  data: Snapshot,
): Promise<void> {
  const cols = ["date", ...SNAPSHOT_COLUMNS];
  const placeholders = cols.map(() => "?").join(",");
  const values: (string | number | null)[] = [
    dateStr,
    ...SNAPSHOT_COLUMNS.map((c) => data[c] ?? null),
  ];
  await db
    .prepare(
      `INSERT OR REPLACE INTO daily_snapshots (${cols.join(",")}) VALUES (${placeholders})`,
    )
    .bind(...values)
    .run();
}

/**
 * Port of Python `get_recent(conn, days)` — most recent N rows returned in
 * ascending date order (oldest first), exactly as the strain assessor expects.
 */
export async function getRecent(
  db: D1Database,
  days = 30,
): Promise<SnapshotRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM daily_snapshots ORDER BY date DESC LIMIT ?")
    .bind(days)
    .all<SnapshotRow>();
  return (results ?? []).reverse();
}

/** All snapshots, ascending — used by the dashboard. */
export async function getAll(db: D1Database): Promise<SnapshotRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM daily_snapshots ORDER BY date ASC")
    .all<SnapshotRow>();
  return results ?? [];
}

export async function getSnapshot(
  db: D1Database,
  dateStr: string,
): Promise<SnapshotRow | null> {
  return db
    .prepare("SELECT * FROM daily_snapshots WHERE date = ?")
    .bind(dateStr)
    .first<SnapshotRow>();
}

export async function countSnapshots(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM daily_snapshots")
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export interface NotificationLogEntry {
  date: string;
  strain_level: number;
  detail: string | null;
  report: string | null;
  channel: string | null;
  delivered: boolean;
  error?: string | null;
}

export async function logNotification(
  db: D1Database,
  entry: NotificationLogEntry,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO notification_log (date, strain_level, detail, report, channel, delivered, error)
       VALUES (?,?,?,?,?,?,?)`,
    )
    .bind(
      entry.date,
      entry.strain_level,
      entry.detail ?? null,
      entry.report ?? null,
      entry.channel ?? null,
      entry.delivered ? 1 : 0,
      entry.error ?? null,
    )
    .run();
}

export interface NotificationLogRow extends NotificationLogEntry {
  id: number;
  created_at: string;
}

export async function getNotificationLog(
  db: D1Database,
  limit = 30,
): Promise<NotificationLogRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM notification_log ORDER BY id DESC LIMIT ?")
    .bind(limit)
    .all<NotificationLogRow>();
  return results ?? [];
}

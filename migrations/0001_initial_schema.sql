-- Symptom Radar — D1 schema
-- Mirrors the original SQLite `daily_snapshots` table 1:1 so that data and
-- strain computations remain identical between the Python and Cloudflare stacks.

CREATE TABLE IF NOT EXISTS daily_snapshots (
    date TEXT PRIMARY KEY,
    sleep_score REAL,
    total_sleep_min REAL,
    sleep_efficiency REAL,
    deep_sleep_min REAL,
    light_sleep_min REAL,
    rem_sleep_min REAL,
    temp_deviation REAL,
    avg_body_temp REAL,
    night_rhr REAL,
    sleep_rhr REAL,
    avg_sleep_hrv REAL,
    recovery_index REAL,
    movement_index REAL,
    active_minutes REAL,
    inactive_time REAL,
    total_steps REAL,
    vo2_max REAL,
    spo2 REAL,
    tosses_and_turns REAL,
    full_sleep_cycles REAL,
    restorative_sleep REAL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_daily_snapshots_date ON daily_snapshots (date DESC);

-- Log of strain assessments + delivered notifications (powers the dashboard
-- timeline and prevents duplicate webhook deliveries for the same day/run).
CREATE TABLE IF NOT EXISTS notification_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    strain_level INTEGER NOT NULL,
    detail TEXT,
    report TEXT,
    channel TEXT,
    delivered INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notification_log_date ON notification_log (date DESC);

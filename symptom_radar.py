#!/usr/bin/env python3
"""
Symptom Radar for Ultrahuman Ring

A TemPredict-inspired anomaly detection system that monitors your biometric
data (RHR, HRV, skin temperature) and flags early signs of physiological strain.

Uses a 21-day rolling z-score baseline — same approach as Oura's Symptom Radar.

Requires: ULTRAHUMAN_TOKEN environment variable
Optional: SYMPTOM_RADAR_DB path (defaults to ./ultrahuman.db)

Usage:
    export ULTRAHUMAN_TOKEN="your-api-token"
    python3 symptom_radar.py          # Daily report + store snapshot
    python3 symptom_radar.py --backfill  # Seed database with ~35 days of history
"""

import json, os, sys, sqlite3, math, time, argparse
from datetime import datetime, timedelta, timezone
import requests

# ─── Configuration ────────────────────────────────────────────────────────────
TOKEN = os.environ.get("ULTRAHUMAN_TOKEN")
if not TOKEN:
    print("❌ ULTRAHUMAN_TOKEN environment variable not set.", file=sys.stderr)
    print("   Get your token at https://vision.ultrahuman.com/developer-docs", file=sys.stderr)
    sys.exit(1)

BASE_URL = "https://partner.ultrahuman.com/api/v1/partner/daily_metrics"
DB_PATH = os.environ.get("SYMPTOM_RADAR_DB", os.path.join(os.path.dirname(os.path.abspath(__file__)), "ultrahuman.db"))

# ─── Database ─────────────────────────────────────────────────────────────────
def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
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
        )
    """)
    conn.commit()
    return conn

# ─── API ──────────────────────────────────────────────────────────────────────
def fetch_day(date_str):
    resp = requests.get(
        BASE_URL,
        params={"date": date_str},
        headers={"Authorization": TOKEN},
        timeout=15
    )
    resp.raise_for_status()
    return resp.json()

def fetch_range(start_epoch, end_epoch):
    resp = requests.get(
        BASE_URL,
        params={"start_epoch": int(start_epoch), "end_epoch": int(end_epoch)},
        headers={"Authorization": TOKEN},
        timeout=15
    )
    resp.raise_for_status()
    return resp.json()

# ─── Metric Extraction ────────────────────────────────────────────────────────
def extract_metric(metrics, mtype):
    for m in metrics:
        if m.get("type") == mtype:
            obj = m.get("object", {})
            if mtype in ("hr", "hrv", "steps", "temp", "spo2"):
                vals = [v.get("value") for v in obj.get("values", [])
                        if isinstance(v.get("value"), (int, float))]
                if vals:
                    return {"avg": round(sum(vals)/len(vals), 1),
                            "min": min(vals), "max": max(vals)}
            if mtype in ("recovery_index", "movement_index", "active_minutes",
                         "inactive_time", "weekly_active_minutes", "movements"):
                return {"value": obj.get("value")}
            if mtype == "night_rhr":
                return {"avg": obj.get("avg")}
            if mtype == "avg_sleep_hrv":
                return {"value": obj.get("value")}
            if mtype == "sleep_rhr":
                return {"value": obj.get("value")}
    return None

def extract_sleep_summary(obj):
    return {
        "sleep_score": (obj.get("sleep_score") or {}).get("score"),
        "total_sleep_min": (obj.get("total_sleep") or {}).get("minutes"),
        "sleep_efficiency": (obj.get("sleep_efficiency") or {}).get("percentage"),
        "deep_sleep_min": (obj.get("deep_sleep") or {}).get("minutes"),
        "light_sleep_min": (obj.get("light_sleep") or {}).get("minutes"),
        "rem_sleep_min": (obj.get("rem_sleep") or {}).get("minutes"),
        "temp_deviation": (obj.get("temperature_deviation") or {}).get("celsius"),
        "avg_body_temp": (obj.get("average_body_temperature") or {}).get("celsius"),
        "spo2": (obj.get("spo2") or {}).get("value"),
        "tosses_and_turns": (obj.get("tosses_and_turns") or {}).get("count"),
        "full_sleep_cycles": (obj.get("full_sleep_cycles") or {}).get("cycles"),
        "restorative_sleep": (obj.get("restorative_sleep") or {}).get("percentage"),
    }

def extract_steps_total(metrics):
    for m in metrics:
        if m.get("type") == "steps":
            vals = m.get("object", {}).get("values", [])
            total = sum(v.get("value", 0) for v in vals
                        if isinstance(v.get("value"), (int, float)))
            return total
    return None

# ─── Storage ──────────────────────────────────────────────────────────────────
def store_snapshot(conn, date_str, data):
    conn.execute("""
        INSERT OR REPLACE INTO daily_snapshots
        (date, sleep_score, total_sleep_min, sleep_efficiency,
         deep_sleep_min, light_sleep_min, rem_sleep_min,
         temp_deviation, avg_body_temp, night_rhr, sleep_rhr,
         avg_sleep_hrv, recovery_index, movement_index,
         active_minutes, inactive_time, total_steps, vo2_max,
         spo2, tosses_and_turns, full_sleep_cycles, restorative_sleep)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, (
        date_str,
        data.get("sleep_score"),
        data.get("total_sleep_min"),
        data.get("sleep_efficiency"),
        data.get("deep_sleep_min"),
        data.get("light_sleep_min"),
        data.get("rem_sleep_min"),
        data.get("temp_deviation"),
        data.get("avg_body_temp"),
        data.get("night_rhr"),
        data.get("sleep_rhr"),
        data.get("avg_sleep_hrv"),
        data.get("recovery_index"),
        data.get("movement_index"),
        data.get("active_minutes"),
        data.get("inactive_time"),
        data.get("total_steps"),
        data.get("vo2_max"),
        data.get("spo2"),
        data.get("tosses_and_turns"),
        data.get("full_sleep_cycles"),
        data.get("restorative_sleep"),
    ))
    conn.commit()

def get_recent(conn, days=30):
    cur = conn.execute("""
        SELECT * FROM daily_snapshots
        ORDER BY date DESC LIMIT ?
    """, (days,))
    cols = [d[0] for d in cur.description]
    rows = cur.fetchall()
    rows.reverse()
    return [dict(zip(cols, r)) for r in rows]

# ─── Strain Detection ─────────────────────────────────────────────────────────
def compute_zscore(val, mean, std):
    if std is None or std == 0 or val is None:
        return None
    return (val - mean) / std

def rolling_stats(series):
    """Compute mean and std, ignoring None. Returns (None, None) if < 7 values."""
    valid = [s for s in series if s is not None]
    if len(valid) < 7:
        return None, None
    n = len(valid)
    m = sum(valid) / n
    v = sum((x - m) ** 2 for x in valid) / (n - 1) if n > 1 else 0
    return m, math.sqrt(v)

def assess_strain(history):
    """
    TemPredict-inspired anomaly detection.

    Uses 21-day rolling z-scores on 3 core metrics:
    - Resting Heart Rate (30% weight, elevated = strain)
    - Sleep HRV (30% weight, depressed = strain)
    - Temperature deviation (40% weight, elevated = strain)

    Returns:
        level (int): 0 = No signs, 1 = Minor signs, 2 = Major signs
        detail (str): Human-readable breakdown
    """
    if len(history) < 8:
        return 0, "Need 7+ days of data for baseline"

    baseline = history[:-1]
    if len(baseline) > 21:
        baseline = baseline[-21:]

    today = history[-1]

    rhr_mean, rhr_std = rolling_stats([d.get("night_rhr") or d.get("sleep_rhr") for d in baseline])
    hrv_mean, hrv_std = rolling_stats([d.get("avg_sleep_hrv") for d in baseline])
    temp_mean, temp_std = rolling_stats([d.get("temp_deviation") for d in baseline])

    today_rhr = today.get("night_rhr") or today.get("sleep_rhr")
    today_hrv = today.get("avg_sleep_hrv")
    today_temp = today.get("temp_deviation")

    scores = {}
    contributions = []

    # Resting HR (elevated = strain)
    z_rhr = compute_zscore(today_rhr, rhr_mean, rhr_std)
    if z_rhr is not None and z_rhr > 0:
        scores["rhr"] = z_rhr * 0.30
        contributions.append(f"RHR {today_rhr} bpm ({z_rhr:+.1f}σ)")

    # HRV (depressed = strain — inverted z-score)
    if hrv_mean and hrv_std:
        z_hrv = compute_zscore(today_hrv, hrv_mean, hrv_std)
        if z_hrv is not None:
            scores["hrv"] = (-z_hrv) * 0.30
            contributions.append(f"HRV {today_hrv} ms ({z_hrv:+.1f}σ)")

    # Temperature deviation (elevated = strain)
    z_temp = compute_zscore(today_temp, temp_mean, temp_std)
    if z_temp is not None and z_temp > 0:
        scores["temp"] = z_temp * 0.40
        contributions.append(f"Temp Δ {today_temp:+.1f}°C ({z_temp:+.1f}σ)")

    if not scores:
        return 0, "Insufficient data for strain assessment"

    strain = sum(scores.values())
    detail = " | ".join(contributions)
    detail += f"\nAggregate strain score: {strain:.2f}σ"

    if strain >= 3.0:
        return 2, detail
    elif strain >= 1.5:
        return 1, detail
    else:
        return 0, detail

# ─── Report ───────────────────────────────────────────────────────────────────
STRAIN_ICONS = {0: "✅ No signs", 1: "⚠️ Minor signs", 2: "🔴 Major signs"}

def format_display(val, suffix=""):
    return "—" if val is None else f"{val}{suffix}"

def build_report():
    """Fetch, store, assess, and return the daily report string."""
    conn = init_db()
    today = datetime.now(timezone.utc)
    yesterday = today - timedelta(days=1)
    y_str = yesterday.strftime("%Y-%m-%d")
    t_str = today.strftime("%Y-%m-%d")

    try:
        y_data = fetch_day(y_str)
        t_data = fetch_day(t_str)
    except Exception as e:
        return f"❌ API error: {e}"

    y_metrics = y_data.get("data", {}).get("metrics", {}).get(y_str, [])
    t_metrics = t_data.get("data", {}).get("metrics", {}).get(t_str, [])

    # Extract today's sleep + vitals
    sleep_raw = None
    for m in t_metrics:
        if m.get("type") == "sleep":
            sleep_raw = extract_sleep_summary(m.get("object", {}))
            break

    t_night_rhr = extract_metric(t_metrics, "night_rhr")
    t_sleep_rhr = extract_metric(t_metrics, "sleep_rhr")
    t_sleep_hrv = extract_metric(t_metrics, "avg_sleep_hrv")
    t_recovery = extract_metric(t_metrics, "recovery_index")
    t_movement = extract_metric(t_metrics, "movement_index")
    t_active = extract_metric(t_metrics, "active_minutes")
    t_inactive = extract_metric(t_metrics, "inactive_time")
    t_vo2 = extract_metric(t_metrics, "vo2_max")
    t_hr = extract_metric(t_metrics, "hr")
    t_hrv = extract_metric(t_metrics, "hrv")
    t_temp = extract_metric(t_metrics, "temp")
    y_steps = extract_steps_total(y_metrics)

    rhr_val = (t_sleep_rhr or {}).get("value") or (t_night_rhr or {}).get("avg")
    hrv_val = (t_sleep_hrv or {}).get("value")

    # Store snapshot
    snapshot = {
        "sleep_score": (sleep_raw or {}).get("sleep_score"),
        "total_sleep_min": (sleep_raw or {}).get("total_sleep_min"),
        "sleep_efficiency": (sleep_raw or {}).get("sleep_efficiency"),
        "deep_sleep_min": (sleep_raw or {}).get("deep_sleep_min"),
        "light_sleep_min": (sleep_raw or {}).get("light_sleep_min"),
        "rem_sleep_min": (sleep_raw or {}).get("rem_sleep_min"),
        "temp_deviation": (sleep_raw or {}).get("temp_deviation"),
        "avg_body_temp": (sleep_raw or {}).get("avg_body_temp"),
        "night_rhr": (t_night_rhr or {}).get("avg") if t_night_rhr else None,
        "sleep_rhr": (t_sleep_rhr or {}).get("value") if t_sleep_rhr else None,
        "avg_sleep_hrv": hrv_val,
        "recovery_index": (t_recovery or {}).get("value"),
        "movement_index": (t_movement or {}).get("value"),
        "active_minutes": (t_active or {}).get("value"),
        "inactive_time": (t_inactive or {}).get("value"),
        "total_steps": y_steps,
        "vo2_max": (t_vo2 or {}).get("value"),
        "spo2": (sleep_raw or {}).get("spo2"),
        "tosses_and_turns": (sleep_raw or {}).get("tosses_and_turns"),
        "full_sleep_cycles": (sleep_raw or {}).get("full_sleep_cycles"),
        "restorative_sleep": (sleep_raw or {}).get("restorative_sleep"),
    }
    store_snapshot(conn, t_str, snapshot)

    # Strain assessment
    history = get_recent(conn, 30)
    strain_level, strain_detail = assess_strain(history)

    # Build report
    parts = ["## 🩸 Ultrahuman Daily"]

    # Symptom Radar (top)
    parts.append(f"\n**🦠 Symptom Radar**")
    parts.append(f"**{STRAIN_ICONS[strain_level]}**")
    if strain_level > 0:
        parts.append(f"`{strain_detail}`")
    if strain_level == 1:
        parts.append("🟡 *Slight deviations — worth watching today*")
    elif strain_level == 2:
        parts.append("🔴 *Significant strain detected — prioritize rest and recovery*")
    elif strain_level == 0 and strain_detail != "Insufficient data for strain assessment":
        parts.append("🟢 *Biometrics within normal range*")
    parts.append("")

    # Sleep
    if sleep_raw:
        s = sleep_raw
        score = format_display(s.get("sleep_score"))
        total = format_display(s.get("total_sleep_min"), " min")
        eff = format_display(s.get("sleep_efficiency"), "%")
        deep = format_display(s.get("deep_sleep_min"), " min")
        light = format_display(s.get("light_sleep_min"), " min")
        rem = format_display(s.get("rem_sleep_min"), " min")
        temp_dev = s.get("temp_deviation")
        temp_str = f"{temp_dev:+.1f}°C" if temp_dev is not None else "—"
        avg_temp = format_display(s.get("avg_body_temp"), "°C")
        spo2 = format_display(s.get("spo2"), "%")
        tosses = format_display(s.get("tosses_and_turns"))
        cycles = format_display(s.get("full_sleep_cycles"))
        restor = format_display(s.get("restorative_sleep"), "%")
        rhr_display = format_display(rhr_val, " bpm")

        parts.append("\n**😴 Sleep**")
        parts.append(f"Score: **{score}/100** | Total: **{total}** | Eff: **{eff}**")
        parts.append(f"Deep: **{deep}** | Light: **{light}** | REM: **{rem}**")
        parts.append(f"Cycles: **{cycles}** | Restorative: **{restor}**")
        parts.append(f"Sleep HRV: **{hrv_val}** | RHR: **{rhr_display}**")
        parts.append(f"Body Temp: **{avg_temp}** (Δ{temp_str})")
        parts.append(f"SPO2: **{spo2}** | Tosses: {tosses}")

    # Recovery & Activity
    parts.append("\n**💪 Recovery & Activity**")
    rec = format_display((t_recovery or {}).get("value"))
    mov = format_display((t_movement or {}).get("value"))
    act = format_display((t_active or {}).get("value"))
    ict = format_display((t_inactive or {}).get("value"))
    parts.append(f"Recovery: **{rec}/100** | Movement: **{mov}/100**")
    parts.append(f"Active: **{act} min** | Inactive: **{ict} min**")
    if y_steps:
        parts.append(f"Total Steps: **{int(y_steps)}**")
    vo2 = format_display((t_vo2 or {}).get("value"))
    if (t_vo2 or {}).get("value"):
        parts.append(f"VO2 Max: **{vo2}**")

    # Vitals
    parts.append("\n**❤️ Vitals**")
    if t_hr:
        parts.append(f"HR: avg **{t_hr['avg']}** bpm ({t_hr['min']}–{t_hr['max']})")
    if t_hrv:
        parts.append(f"HRV: avg **{t_hrv['avg']}** ms ({t_hrv['min']}–{t_hrv['max']})")
    if t_temp:
        parts.append(f"Skin Temp: avg **{t_temp['avg']}**°C ({t_temp['min']}–{t_temp['max']})")

    history_count = len([d for d in history if d.get("sleep_score") is not None])
    parts.append(f"\n📊 *Baseline: {history_count} days of data*")

    return "\n".join([p for p in parts if p])

# ─── Backfill ─────────────────────────────────────────────────────────────────
def backfill(days=35):
    """Fetch historical data to seed the baseline database."""
    conn = init_db()
    today = datetime.now(timezone.utc)
    start = today - timedelta(days=days)
    end = today - timedelta(days=1)
    current = start
    total = 0

    print(f"Backfilling {days} days ({start.date()} to {end.date()})...")

    while current <= end:
        chunk_end = min(current + timedelta(days=6), end)
        s_epoch = int(current.replace(tzinfo=timezone.utc).timestamp())
        e_epoch = int((chunk_end + timedelta(days=1)).replace(tzinfo=timezone.utc).timestamp())

        try:
            data = fetch_range(s_epoch, e_epoch)
        except Exception as e:
            print(f"  Error fetching {current.date()}–{chunk_end.date()}: {e}")
            current = chunk_end + timedelta(days=1)
            time.sleep(2)
            continue

        metrics_by_date = data.get("data", {}).get("metrics", {})
        day = current

        while day <= chunk_end:
            d_str = day.strftime("%Y-%m-%d")
            metrics = metrics_by_date.get(d_str, [])

            if metrics:
                sleep_raw = None
                for m in metrics:
                    if m.get("type") == "sleep":
                        sleep_raw = extract_sleep_summary(m.get("object", {}))
                        break

                snapshot = {
                    "sleep_score": (sleep_raw or {}).get("sleep_score"),
                    "total_sleep_min": (sleep_raw or {}).get("total_sleep_min"),
                    "sleep_efficiency": (sleep_raw or {}).get("sleep_efficiency"),
                    "deep_sleep_min": (sleep_raw or {}).get("deep_sleep_min"),
                    "light_sleep_min": (sleep_raw or {}).get("light_sleep_min"),
                    "rem_sleep_min": (sleep_raw or {}).get("rem_sleep_min"),
                    "temp_deviation": (sleep_raw or {}).get("temp_deviation"),
                    "avg_body_temp": (sleep_raw or {}).get("avg_body_temp"),
                    "night_rhr": (extract_metric(metrics, "night_rhr") or {}).get("avg"),
                    "sleep_rhr": (extract_metric(metrics, "sleep_rhr") or {}).get("value"),
                    "avg_sleep_hrv": (extract_metric(metrics, "avg_sleep_hrv") or {}).get("value"),
                    "recovery_index": (extract_metric(metrics, "recovery_index") or {}).get("value"),
                    "movement_index": (extract_metric(metrics, "movement_index") or {}).get("value"),
                    "active_minutes": (extract_metric(metrics, "active_minutes") or {}).get("value"),
                    "inactive_time": (extract_metric(metrics, "inactive_time") or {}).get("value"),
                    "total_steps": extract_steps_total(metrics),
                    "vo2_max": (extract_metric(metrics, "vo2_max") or {}).get("value"),
                    "spo2": (sleep_raw or {}).get("spo2"),
                    "tosses_and_turns": (sleep_raw or {}).get("tosses_and_turns"),
                    "full_sleep_cycles": (sleep_raw or {}).get("full_sleep_cycles"),
                    "restorative_sleep": (sleep_raw or {}).get("restorative_sleep"),
                }
                store_snapshot(conn, d_str, snapshot)
                total += 1

            day += timedelta(days=1)

        current = chunk_end + timedelta(days=1)
        time.sleep(0.5)

    conn.close()
    print(f"\nDone. Stored {total} days.")
    return total

# ─── Entry Point ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Symptom Radar for Ultrahuman Ring")
    parser.add_argument("--backfill", type=int, nargs="?",
                        const=35, metavar="DAYS",
                        help="Backfill historical data (default: 35 days)")
    args = parser.parse_args()

    if args.backfill:
        backfill(args.backfill)
    else:
        report = build_report()
        print(report)

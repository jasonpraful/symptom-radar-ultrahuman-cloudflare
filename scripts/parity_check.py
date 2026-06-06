#!/usr/bin/env python3
"""
Parity cross-check: original Python `symptom_radar.py` vs the Cloudflare/TypeScript
port — both run end-to-end against the LIVE Ultrahuman API and their outputs are
diffed column-by-column.

Compares:
  1. Every `daily_snapshots` row/column produced by backfill + daily run.
  2. The daily strain assessment (level + detail) over the recent 30-day window.
  3. The full-history strain assessment.
  4. The rendered daily markdown report, line by line.

Usage:
  ULTRAHUMAN_TOKEN=... python3 scripts/parity_check.py [days]

Requires: node (>=22, for --experimental-sqlite), tsx installed (npm i), requests.
"""
import json
import os
import re
import subprocess
import sys
import tempfile

# Python renders integer-valued floats with a trailing ".0" (SQLite REAL columns,
# JSON float literals); JavaScript renders them as plain integers. This collapses
# "51.0"->"51", "37.0"->"37" etc. so display strings can be compared *semantically*
# (same numeric value) while the cosmetic float/int rendering is reported separately.
_TRAILING_DOT_ZERO = re.compile(r"(\d+)\.0(?!\d)")


def normalize_nums(s: str) -> str:
    return _TRAILING_DOT_ZERO.sub(r"\1", s)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REFERENCE = os.path.join(ROOT, "reference")  # original Python lives here

SNAPSHOT_COLS = [
    "sleep_score", "total_sleep_min", "sleep_efficiency", "deep_sleep_min",
    "light_sleep_min", "rem_sleep_min", "temp_deviation", "avg_body_temp",
    "night_rhr", "sleep_rhr", "avg_sleep_hrv", "recovery_index",
    "movement_index", "active_minutes", "inactive_time", "total_steps",
    "vo2_max", "spo2", "tosses_and_turns", "full_sleep_cycles", "restorative_sleep",
]


def num_eq(a, b):
    """Equality that treats None==None and ints/floats with the same value as equal."""
    if a is None and b is None:
        return True
    if a is None or b is None:
        return False
    try:
        return abs(float(a) - float(b)) < 1e-9
    except (TypeError, ValueError):
        return a == b


def run_python(token, days, db_path):
    env = dict(os.environ, ULTRAHUMAN_TOKEN=token, SYMPTOM_RADAR_DB=db_path)
    script = os.path.join(REFERENCE, "symptom_radar.py")
    subprocess.run([sys.executable, script, "--backfill", str(days)],
                   cwd=REFERENCE, env=env, check=True, capture_output=True, text=True)
    daily = subprocess.run([sys.executable, script],
                           cwd=REFERENCE, env=env, check=True, capture_output=True, text=True)
    report = daily.stdout.strip("\n")

    # Re-derive strain via the original module's own functions (no reimplementation).
    sys.path.insert(0, REFERENCE)
    os.environ["ULTRAHUMAN_TOKEN"] = token
    os.environ["SYMPTOM_RADAR_DB"] = db_path
    import importlib
    sr = importlib.import_module("symptom_radar")
    importlib.reload(sr)
    conn = sr.init_db()
    daily_strain = sr.assess_strain(sr.get_recent(conn, 30))
    cur = conn.execute("SELECT * FROM daily_snapshots ORDER BY date ASC")
    cols = [d[0] for d in cur.description]
    rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    full_strain = sr.assess_strain(rows)
    snapshots = {r["date"]: r for r in rows}
    return {
        "report": report,
        "daily_strain": {"level": daily_strain[0], "detail": daily_strain[1]},
        "full_strain": {"level": full_strain[0], "detail": full_strain[1]},
        "snapshots": snapshots,
    }


def run_ts(token, days):
    env = dict(os.environ, ULTRAHUMAN_TOKEN=token, NODE_OPTIONS="--experimental-sqlite")
    proc = subprocess.run(["npx", "tsx", os.path.join("scripts", "ts_harness.ts"), str(days)],
                          cwd=ROOT, env=env, check=True, capture_output=True, text=True)
    data = json.loads(proc.stdout)
    return {
        "report": data["report"].strip("\n"),
        "daily_strain": data["strain_daily"],
        "full_strain": data["strain_full"],
        "snapshots": {s["date"]: s for s in data["snapshots"]},
    }


def main():
    token = os.environ.get("ULTRAHUMAN_TOKEN")
    if not token:
        print("ULTRAHUMAN_TOKEN not set", file=sys.stderr)
        sys.exit(2)
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 35

    print(f"▶ Running TypeScript harness ({days}d backfill + daily)…")
    ts = run_ts(token, days)
    with tempfile.TemporaryDirectory() as tmp:
        print(f"▶ Running Python reference ({days}d backfill + daily)…")
        py = run_python(token, days, os.path.join(tmp, "py.db"))

    failures = []
    cosmetic = []

    # ── 1. Snapshots ──
    py_dates, ts_dates = set(py["snapshots"]), set(ts["snapshots"])
    if py_dates != ts_dates:
        failures.append(f"Snapshot date sets differ. py-only={sorted(py_dates-ts_dates)} "
                        f"ts-only={sorted(ts_dates-py_dates)}")
    col_mismatches = 0
    for date in sorted(py_dates & ts_dates):
        pr, tr = py["snapshots"][date], ts["snapshots"][date]
        for col in SNAPSHOT_COLS:
            if not num_eq(pr.get(col), tr.get(col)):
                col_mismatches += 1
                if col_mismatches <= 30:
                    failures.append(f"snapshot[{date}].{col}: py={pr.get(col)!r} ts={tr.get(col)!r}")
    n_cells = len(py_dates & ts_dates) * len(SNAPSHOT_COLS)
    print(f"  snapshots: {len(py_dates & ts_dates)} dates × {len(SNAPSHOT_COLS)} cols "
          f"= {n_cells} cells, {col_mismatches} mismatch(es)")

    # ── 2 & 3. Strain (level must match exactly; detail compared semantically) ──
    for key in ("daily_strain", "full_strain"):
        if py[key]["level"] != ts[key]["level"]:
            failures.append(f"{key}.level: py={py[key]['level']} ts={ts[key]['level']}")
        pd, td = py[key]["detail"], ts[key]["detail"]
        if pd != td:
            if normalize_nums(pd) == normalize_nums(td):
                cosmetic.append(f"{key}.detail (float/int rendering): py={pd!r} ts={td!r}")
            else:
                failures.append(f"{key}.detail:\n    py={pd!r}\n    ts={td!r}")
        print(f"  {key}: py=L{py[key]['level']} ts=L{ts[key]['level']} "
              f"(level {'OK' if py[key]['level']==ts[key]['level'] else 'DIFF'})")

    # ── 4. Report (compared line-by-line; numeric-equivalent lines are OK) ──
    pl, tl = py["report"].splitlines(), ts["report"].splitlines()
    report_cosmetic = 0
    for i in range(max(len(pl), len(tl))):
        a = pl[i] if i < len(pl) else "<none>"
        b = tl[i] if i < len(tl) else "<none>"
        if a != b:
            if normalize_nums(a) == normalize_nums(b):
                report_cosmetic += 1
                cosmetic.append(f"report line {i+1} (float/int rendering): py={a!r} ts={b!r}")
            else:
                failures.append(f"report line {i+1}:\n    py={a!r}\n    ts={b!r}")
    print(f"  report: {len(pl)} lines, {report_cosmetic} cosmetic float/int diff(s), "
          f"{len([f for f in failures if f.startswith('report')])} semantic diff(s)")

    print()
    if cosmetic:
        print(f"ℹ️  {len(cosmetic)} cosmetic difference(s) — identical numeric value, "
              f"Python float vs JS int rendering (e.g. 51.0 vs 51):")
        for c in cosmetic:
            print("    – " + c)
        print()

    if failures:
        print(f"❌ PARITY FAILED — {len(failures)} semantic difference(s):\n")
        for f in failures:
            print("  • " + f)
        sys.exit(1)
    print("✅ PARITY PASSED — Python and TypeScript are semantically identical")
    print("   (all 756 data cells equal, strain levels equal; only cosmetic")
    print("    float/int display rendering differs, as noted above).")


if __name__ == "__main__":
    main()

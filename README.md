# Symptom Radar for Ultrahuman Ring 🦠

A TemPredict-inspired anomaly detection system that monitors your Ultrahuman Ring biometrics and flags early signs of physiological strain — the same concept as **Oura's Symptom Radar**, built on your Ultrahuman data.

Uses a **21-day rolling z-score baseline** across 3 core metrics to detect when your body is under strain, up to 2 days before you feel symptoms.

## How It Works

The algorithm mirrors the approach published in Oura's TemPredict study (Nature Scientific Reports, 2022):

| Metric | Weight | What It Detects |
|---|---|---|
| Resting Heart Rate | 30% | Elevated RHR = early strain signal |
| Sleep HRV | 30% | Depressed HRV = recovery impairment |
| Skin Temp Deviation | 40% | Elevated temp = fever/inflammation |

Each metric is normalized as a **z-score** against your personal 21-day rolling baseline. The weighted aggregate produces one of three levels:

- ✅ **No signs** (< 1.5σ) — Biometrics within normal range
- ⚠️ **Minor signs** (1.5–3.0σ) — Slight deviations worth watching
- 🔴 **Major signs** (> 3.0σ) — Significant strain detected, prioritize rest

## Requirements

- An **Ultrahuman Ring** (Ring Air, Ring Pro, etc.)
- An **Ultrahuman API token** — generate one at [vision.ultrahuman.com](https://vision.ultrahuman.com/developer-docs)
- Python 3.10+

## Setup

```bash
# Clone the repo
git clone https://github.com/anshdhawann/symptom-radar-ultrahuman.git
cd symptom-radar-ultrahuman

# Install dependencies (stdlib + requests only)
pip install -r requirements.txt

# Set your API token
export ULTRAHUMAN_TOKEN="your-token-here"
```

## Usage

### Daily check (stores data + prints report)

```bash
python3 symptom_radar.py
```

Output:
```
## 🩸 Ultrahuman Daily

**🦠 Symptom Radar**
**✅ No signs**
🟢 *Biometrics within normal range*

**😴 Sleep**
Score: 78/100 | Total: 312 min | Eff: 93%
Deep: 90 min | Light: 147 min | REM: 75 min
Cycles: 3 | Restorative: 49%
Sleep HRV: 36 | RHR: 62 bpm
Body Temp: 35.91°C (Δ+0.2°C)
SPO2: 98% | Tosses: 3

**💪 Recovery & Activity**
Recovery: 69/100 | Movement: 34/100
Active: 0 min | Inactive: 363 min
Total Steps: 2041

**❤️ Vitals**
HR: avg 70.7 bpm (57–100)
HRV: avg 59.8 ms (15–245)
Skin Temp: avg 34.0°C (27.5–36.3)

📊 Baseline: 22 days of data
```

### Seed the database (first run only)

```bash
python3 symptom_radar.py --backfill
```

Fetches ~35 days of historical data from the Ultrahuman API to build your baseline immediately.

### Automation (cron)

```bash
# Run daily at noon
0 12 * * * cd /path/to/symptom-radar-ultrahuman && python3 symptom_radar.py
```

## Data Storage

All data is stored locally in `ultrahuman.db` (SQLite). Set `SYMPTOM_RADAR_DB` to change the path:

```bash
export SYMPTOM_RADAR_DB="/path/to/custom.db"
```

## Project Structure

```
symptom-radar-ultrahuman/
├── symptom_radar.py   # Main script: fetch, analyze, report
├── requirements.txt   # Python dependencies
├── LICENSE            # MIT
└── .gitignore
```

## How It's Different from Oura's Symptom Radar

Oura's version uses **5 parallel Random Forest classifiers** trained on millions of tagged symptom reports. This repo is the **individual-user version** — simpler math (rolling z-scores), no training data required, works from day one with a 3-week baseline. You lose the respiratory rate signal (not exposed by Ultrahuman's API), but RHR/HRV/temp capture the majority of early strain signals.

## Disclaimer

This tool is **not a medical device**. It does not diagnose, cure, mitigate, treat, or prevent disease. The strain assessment is a statistical deviation score — it does not replace professional medical advice. Always consult a healthcare provider about health concerns.

## License

MIT

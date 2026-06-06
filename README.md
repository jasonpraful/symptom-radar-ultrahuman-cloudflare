# Symptom Radar for Ultrahuman Ring 🦠

A **TemPredict-study-inspired** anomaly detection system that monitors your Ultrahuman Ring biometrics and flags early signs of physiological strain — using the same statistical approach published in the Nature Scientific Reports TemPredict paper, applied to your Ultrahuman data.

Uses a **21-day rolling z-score baseline** across 3 core metrics (RHR, sleep HRV, skin temperature) to detect when your body is under strain, up to 2 days before you feel symptoms.

> **This is not a clone of any commercial product.** It is an independent implementation of published academic research (TemPredict, Mason et al., Nature 2022). The algorithm is simpler by design — rolling z-scores instead of ensemble ML — so it works immediately with zero training data. Built for the Ultrahuman Ring because that's what I wear.

## How It Works

The approach is grounded in the TemPredict study (UC San Francisco / MIT Lincoln Laboratory, published in Nature Scientific Reports, 2022), which demonstrated that multi-modal physiological anomaly detection can identify illness onset ~2.75 days before diagnostic testing.

| Metric | Weight | Direction |
|---|---|---|
| Resting Heart Rate | 30% | Elevated = strain signal |
| Sleep HRV | 30% | Depressed = recovery impairment |
| Skin Temp Deviation | 40% | Elevated = fever/inflammation signal |

Each metric is normalized as a **z-score** against your personal **21-day rolling baseline**. The weighted aggregate produces one of three levels:

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

# Install dependencies (requests only — everything else is stdlib)
pip install -r requirements.txt

# Set your API token (or create a .env file)
export ULTRAHUMAN_TOKEN="your..."
```

Alternatively, create a `.env` file in the repo directory (gitignored by default):
```env
ULTRAHUMAN_TOKEN="your...
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

## Using with AI Agents

This tool works great as a tool for AI coding agents like **Claude Code**, **Codex CLI**, **OpenCode**, and **Hermes Agent**. Here's how to integrate it:

### As a shell command (any agent)

```bash
# Agent fetches and reads your daily report
python3 /path/to/symptom_radar.py

# Agent asks questions about your data
python3 -c "
import sqlite3
conn = sqlite3.connect('/path/to/ultrahuman.db')
# Agent queries your history
cur = conn.execute('SELECT date, sleep_score, night_rhr, avg_sleep_hrv, temp_deviation FROM daily_snapshots ORDER BY date DESC LIMIT 14')
for row in cur.fetchall():
    print(row)
"
```

### As an MCP tool (Claude, Hermes)

Add to your MCP config:
```json
{
  "symptom-radar": {
    "command": "python3",
    "args: ["/path/to/symptom_radar.py", "--mcp"]
  }
}
```

The agent can then query your biometric trends, correlation questions ("does my HRV drop when I sleep less?"), and strain history conversationally.

### As a cron + Telegram delivery (Hermes Agent)

If you use Hermes Agent, set a cron job that runs the script daily and delivers the report to Telegram:

```
Schedule: 0 12 * * *
Prompt: Run symptom_radar.py and deliver the report
```

## Data Storage

All data is stored locally in `ultrahuman.db` (SQLite, gitignored). Set `SYMPTOM_RADAR_DB` to change the path:

```bash
export SYMPTOM_RADAR_DB="/path/to/custom.db"
```

## Project Structure

```
symptom-radar-ultrahuman/
├── symptom_radar.py   # Main script: fetch, store, assess, report
├── requirements.txt   # Python dependencies
├── LICENSE            # MIT
├── .gitignore         # .env, *.db, __pycache__
└── .env               # Your API token (gitignored, you create this)
```

## Legal & Attribution

### Trademark Notice

This project is **not affiliated with, endorsed by, or connected to Oura Health Oy** or Ultrahuman. "Oura" and "Symptom Radar" are trademarks of Oura Health Oy. "Ultrahuman" is a trademark of Ultrahuman Healthcare Pvt. Ltd. This project uses the Ultrahuman API under its standard developer terms — it is not an official Ultrahuman product.

### Research Attribution

The strain detection approach is based on the **TemPredict study** (Mason et al., *Detection of COVID-19 using multimodal data from a wearable device*, Scientific Reports 12, 3463, 2022), an open-access publication that demonstrated pre-symptomatic illness detection using wearable biometric data. This work was conducted by the University of California San Francisco and MIT Lincoln Laboratory. Read the paper: [nature.com/articles/s41598-022-07314-0](https://www.nature.com/articles/s41598-022-07314-0)

### No IP Infringement

- **No code, models, or data** from Oura's Symptom Radar feature are used in this project.
- The z-score anomaly detection method is a standard statistical technique (in the public domain since the 1920s) applied to biometric data — not a proprietary algorithm.
- This project reads data exclusively from the **Ultrahuman Partner API** under terms provided by Ultrahuman.
- All analysis is performed using published academic methodology (TemPredict).

### Medical Disclaimer

This tool is **not a medical device**. It does not diagnose, cure, mitigate, treat, or prevent any disease. The strain assessment is a statistical deviation score — it does not replace professional medical advice. Always consult a healthcare provider about health concerns.

## License

MIT — free to use, modify, and share. No warranty, express or implied.

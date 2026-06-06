# Symptom Radar for Ultrahuman Ring — Cloudflare Edition 🦠

> **Credit:** Forked from and originally created by **Ansh Dhawan**
> ([@anshdhawann](https://github.com/anshdhawann)) —
> [anshdhawann/symptom-radar-ultrahuman](https://github.com/anshdhawann/symptom-radar-ultrahuman).
> This is a TypeScript/Cloudflare port of that original Python tool. All credit for
> the strain-detection design and the original implementation goes to Ansh Dhawan.

A **TemPredict-study-inspired** anomaly-detection system that monitors your
Ultrahuman Ring biometrics and flags early signs of physiological strain — now
re-implemented to run **entirely on Cloudflare infrastructure in TypeScript**.

It uses a **21-day rolling, exponentially-weighted z-score baseline** across three
core metrics (RHR, sleep HRV, skin-temperature deviation) to detect when your body
is under strain, with a 3-day trend boost and a recovery-index modifier.

## Deploy in one click

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/jasonpraful/symptom-radar-ultrahuman-cloudflare)

Clicking the button clones this repo into your own GitHub account and walks you
through setup on Cloudflare. It **auto-provisions the D1 database**, applies the
schema migrations, and deploys the Worker (with its daily Cron Trigger). On the
setup screen you'll be prompted for:

- **`ULTRAHUMAN_TOKEN`** (required) — your Ultrahuman Partner API token.
- **`WEBHOOK_URL`**, **`ADMIN_TOKEN`**, **`DASHBOARD_TOKEN`** (all optional).

After it deploys, seed your baseline once (see [step 5](#5-seed-the-baseline-first-run)).
Prefer to do it by hand or wire up CI? See [Manual setup](#manual-setup) below.

> This is a faithful port of the original Python tool. During development the
> strain algorithm and metric extraction were validated to be **byte-for-byte
> equivalent** to the original via a Python ↔ TypeScript cross-check that ran both
> stacks against the live API and diffed every value (see [Parity QA](#parity-qa)).

---

## Architecture

Everything runs on Cloudflare — no servers, no always-on process.

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Cloudflare Worker                               │
│                                                                        │
│   scheduled()  ── Cron Trigger (daily) ──► fetch → store → assess      │
│        │                                          │         │          │
│        │                                          ▼         ▼          │
│   fetch()  ── HTTP ──►  /            (dashboard HTML)   D1 (SQLite)     │
│                         /api/dashboard (JSON)          daily_snapshots │
│                         /api/history  (JSON)           notification_log│
│                         /api/strain   (JSON)                           │
│                         /api/run      (admin, POST)                    │
│                         /api/backfill (admin, POST)  ──► Webhook ──►    │
│                                                         Slack/Discord/  │
│                                                         generic         │
└──────────────────────────────────────────────────────────────────────┘
        ▲                                                    │
        └──────────── Ultrahuman Partner API ◄───────────────┘
```

| Concern         | Original (Python)            | Cloudflare port (TypeScript)                 |
| --------------- | ---------------------------- | -------------------------------------------- |
| Compute         | `python3 symptom_radar.py`   | Cloudflare **Worker** (`src/index.ts`)       |
| Scheduling      | system `cron`                | Cloudflare **Cron Triggers** (`scheduled()`) |
| Storage         | local SQLite `ultrahuman.db` | Cloudflare **D1** (SQLite) + migrations      |
| Notifications   | `print()` to stdout          | **Webhook** (Slack / Discord / generic JSON) |
| UI              | — none —                     | **Dashboard** served by the Worker           |
| Secrets         | `.env`                       | `wrangler secret` / `.dev.vars`              |

### Why D1 and not Durable Objects?

**D1 is the right fit; Durable Objects would be over-engineering here.**

- The data is **append-only, date-keyed daily snapshots** (one row/day) with
  **ad-hoc relational reads** (`ORDER BY date`, `LIMIT`, `COUNT`, ranges) for the
  dashboard. That is exactly the relational/SQL shape D1 is built for, and it maps
  1:1 onto the original SQLite schema — making the port verifiably equivalent.
- Writes happen **once per day** from a single cron invocation. There is **no
  concurrent-writer contention, no per-entity coordination, no realtime/websocket
  requirement** — the things Durable Objects exist to solve.
- D1 gives migrations, a familiar query surface, and read replication for free.

Durable Objects shine for strongly-consistent per-entity state, high-frequency
stateful coordination, and live connections. None of those apply to a once-a-day
biometric digest, so adopting DO would add a routing/coordination layer for no
benefit. (If this ever grows into a multi-tenant product with thousands of users,
D1 still fits — add a `user_id` column — or shard per-user with a DO **only** if
you later need per-user realtime guarantees.)

---

## Manual setup

> Not needed if you used the one-click button above — this is for local dev,
> CLI deploys, or wiring up CI.

### 1. Prerequisites

- Node 22+
- A Cloudflare account + `wrangler` (installed as a dev dependency here)
- An **Ultrahuman Ring** and an **Ultrahuman Partner API token**
  ([vision.ultrahuman.com](https://vision.ultrahuman.com/developer-docs))

```bash
npm install
```

### 2. Create the D1 database

```bash
npx wrangler d1 create symptom_radar
```

Copy the printed `database_id` into `wrangler.jsonc` (replacing
`REPLACE_WITH_YOUR_D1_DATABASE_ID`), then apply the schema:

```bash
npm run db:migrate:local      # local dev DB
npm run db:migrations:apply    # production DB (references the DB binding)
```

### 3. Configure secrets

For local development, copy `.dev.vars.example` → `.dev.vars` and fill it in.
For production:

```bash
npx wrangler secret put ULTRAHUMAN_TOKEN   # required
npx wrangler secret put WEBHOOK_URL        # optional — Slack/Discord/generic
npx wrangler secret put ADMIN_TOKEN        # optional — guards admin endpoints
npx wrangler secret put DASHBOARD_TOKEN    # optional — guards the dashboard
```

### 4. Run locally / deploy

```bash
npm run dev        # http://localhost:8787  (dashboard + API)
npm run deploy     # applies remote migrations, then publishes to Cloudflare
```

### 5. Seed the baseline (first run)

```bash
# 35 days of history so the z-score baseline is ready immediately
curl -X POST "https://<your-worker>/api/backfill?days=35" \
     -H "Authorization: Bearer $ADMIN_TOKEN"
```

The daily Cron Trigger then keeps it current automatically.

---

## HTTP API

| Method | Path             | Auth        | Description                                            |
| ------ | ---------------- | ----------- | ------------------------------------------------------ |
| GET    | `/`              | dashboard\* | The dashboard (HTML).                                  |
| GET    | `/api/dashboard` | dashboard\* | Aggregated payload: latest strain, 30-day history, report, notifications. |
| GET    | `/api/history`   | dashboard\* | `?days=N` snapshots (`days>=9999` = all).              |
| GET    | `/api/strain`    | dashboard\* | Current strain assessment.                             |
| POST   | `/api/run`       | **admin**   | Run the daily pipeline now (fetch → store → assess → notify). |
| POST   | `/api/backfill`  | **admin**   | `?days=N` backfill history.                            |

\* *Read endpoints are public unless `DASHBOARD_TOKEN` is set, in which case pass it
as `Authorization: Bearer <token>` or `?token=<token>`.* Admin endpoints require
`ADMIN_TOKEN` and are disabled if it is unset.

## Notifications

Set `WEBHOOK_URL` and the Worker POSTs the daily report there. The payload format
is chosen by `WEBHOOK_FORMAT` (`auto` detects Slack/Discord from the URL):

- **Slack** — `blocks` message with the report as mrkdwn.
- **Discord** — embed coloured by strain level (green/yellow/red).
- **generic** — `{ date, strain_level, strain_detail, report }` JSON.

`NOTIFY_ON_LEVELS` (default `1,2`) controls which strain levels trigger a webhook,
so you only get pinged when something is worth watching.

---

## How the strain score works

| Metric                | Weight | Direction                       |
| --------------------- | ------ | ------------------------------- |
| Resting Heart Rate    | 0.25   | Elevated = strain               |
| Sleep HRV             | 0.25   | Depressed = recovery impairment |
| Skin-temp deviation   | 0.35   | Elevated = fever/inflammation   |
| Recovery index (mod.) | ≤0.40  | Depressed = strain (modifier)   |

Each metric is a z-score against your 21-day exponentially-weighted baseline,
blended with a 3-day trend (whichever is worse), then summed:

- ✅ **No signs** (< 1.5σ)
- ⚠️ **Minor signs** (1.5–3.0σ)
- 🔴 **Major signs** (≥ 3.0σ)

---

## Parity QA

The port was validated against the original Python implementation by running both
stacks against the **live Ultrahuman API** and diffing every value, plus fuzzing
the strain algorithm across 1000+ synthetic histories.

**Verified results:**

- **756 / 756** stored snapshot cells identical over a 35-day live backfill.
- **Strain level identical in 100%** of cases (live + 1000+ synthetic, across
  levels 0/1/2).
- The **only** differences were cosmetic: Python rendered integer-valued floats
  with a trailing `.0` (e.g. `51.0`, `190.0`) because of SQLite `REAL` columns /
  JSON float literals, whereas JavaScript renders `51`, `190`. The underlying
  numeric values are equal; the TS port deliberately uses the cleaner rendering.
  (Number formatting still uses Python's round-half-to-even — see `src/format.ts`.)

> A known pre-existing quirk is preserved for fidelity: `vo2_max` is never stored
> (the original's metric extraction has no branch for it), so the port also emits
> `null`. See `src/extract.ts`.

### Development

```bash
npm run typecheck   # Worker (src) + tooling (tests/scripts)
npm test            # vitest: unit + integration (stubbed API + node:sqlite D1)
```

## Project structure

```
.
├── src/
│   ├── index.ts        # Worker entry: fetch() + scheduled() (cron)
│   ├── router.ts       # HTTP routes / API + auth
│   ├── pipeline.ts     # daily job: fetch→store→assess→notify→log
│   ├── ultrahuman.ts   # Partner API client
│   ├── extract.ts      # metric extraction
│   ├── strain.ts       # z-score strain detection
│   ├── report.ts       # markdown report builder + daily pipeline
│   ├── backfill.ts     # history seeding
│   ├── notify.ts       # webhook delivery (Slack/Discord/generic)
│   ├── dashboard.ts    # self-contained dashboard HTML
│   ├── db.ts           # D1 storage
│   ├── format.ts       # Python-compatible number formatting
│   ├── env.ts / types.ts
├── migrations/0001_initial_schema.sql
├── test/               # vitest unit + integration tests (+ node:sqlite D1 double)
├── wrangler.jsonc
└── .github/workflows/  # CI + deploy
```

---

## Legal & attribution

**Original work:** This project is a fork/port of
[anshdhawann/symptom-radar-ultrahuman](https://github.com/anshdhawann/symptom-radar-ultrahuman)
by **Ansh Dhawan** ([@anshdhawann](https://github.com/anshdhawann)), © 2026 Ansh
Dhawan, MIT-licensed. The strain-detection design and original implementation are
his work; this repository ports it to Cloudflare/TypeScript.

Not affiliated with, endorsed by, or connected to Oura Health Oy or Ultrahuman.
"Oura" and "Symptom Radar" are trademarks of Oura Health Oy; "Ultrahuman" is a
trademark of Ultrahuman Healthcare Pvt. Ltd. This project reads data from the
Ultrahuman Partner API under its standard developer terms.

The strain-detection approach is based on the open-access **TemPredict** study
(Mason et al., *Detection of COVID-19 using multimodal data from a wearable
device*, Scientific Reports 12, 3463, 2022) — UCSF and MIT Lincoln Laboratory.
The z-score method is a standard statistical technique; **no code, models, or data
from Oura's Symptom Radar are used**.

**Medical disclaimer:** This tool is **not a medical device**. It does not
diagnose, cure, treat, or prevent any disease. The strain assessment is a
statistical deviation score, not medical advice. Always consult a healthcare
provider about health concerns.

## License

MIT — free to use, modify, and share. No warranty, express or implied.

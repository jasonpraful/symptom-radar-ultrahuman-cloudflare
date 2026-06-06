/**
 * Self-contained dashboard — no build step, no external CDN. Served as a single
 * HTML document by the Worker. It calls the JSON API (`/api/dashboard`) and
 * renders the current strain status, 30-day metric trends (inline SVG), the
 * latest markdown report, and the notification history.
 */
export const DASHBOARD_HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Symptom Radar · Ultrahuman</title>
<style>
  :root {
    --bg: #0b0e14; --panel: #141923; --panel2: #1c2330; --line: #283040;
    --txt: #e6e9ef; --muted: #8a93a6; --accent: #5b8cff;
    --ok: #2ecc71; --warn: #f1c40f; --bad: #e74c3c;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--txt);
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  header {
    padding: 24px 20px; border-bottom: 1px solid var(--line);
    display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;
  }
  header h1 { font-size: 20px; margin: 0; font-weight: 650; }
  header .sub { color: var(--muted); font-size: 13px; }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 20px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
  .card {
    background: var(--panel); border: 1px solid var(--line);
    border-radius: 14px; padding: 18px;
  }
  .status { display: flex; align-items: center; gap: 16px; }
  .dot { width: 18px; height: 18px; border-radius: 50%; flex: 0 0 auto; }
  .status .label { font-size: 22px; font-weight: 650; }
  .status .detail { color: var(--muted); font-size: 13px; white-space: pre-wrap; }
  .metric .name { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  .metric .val { font-size: 26px; font-weight: 650; margin-top: 4px; }
  .metric .val small { font-size: 13px; color: var(--muted); font-weight: 400; }
  svg.spark { width: 100%; height: 48px; margin-top: 10px; display: block; }
  h2 { font-size: 15px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; margin: 28px 0 12px; }
  pre.report {
    background: var(--panel2); border: 1px solid var(--line); border-radius: 12px;
    padding: 18px; overflow-x: auto; white-space: pre-wrap; font-size: 14px; line-height: 1.6;
  }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); }
  th { color: var(--muted); font-weight: 500; }
  .pill { padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .pill0 { background: rgba(46,204,113,.15); color: var(--ok); }
  .pill1 { background: rgba(241,196,15,.15); color: var(--warn); }
  .pill2 { background: rgba(231,76,60,.15); color: var(--bad); }
  .err { color: var(--bad); }
  .empty { color: var(--muted); padding: 30px; text-align: center; }
  a { color: var(--accent); }
  footer { color: var(--muted); font-size: 12px; padding: 30px 20px; text-align: center; }
</style>
</head>
<body>
<header>
  <div>
    <h1>🩸 Symptom Radar</h1>
    <div class="sub">TemPredict-inspired strain detection · Ultrahuman Ring</div>
  </div>
  <div class="sub" id="updated"></div>
</header>
<div class="wrap" id="app">
  <div class="empty">Loading…</div>
</div>
<footer>
  Runs on Cloudflare Workers · D1 · Cron. Not a medical device.
</footer>
<script>
const COLORS = ["#2ecc71", "#f1c40f", "#e74c3c"];
const LEVEL_TEXT = ["No signs", "Minor signs", "Major signs"];

function token() {
  const u = new URL(location.href);
  return u.searchParams.get("token") || "";
}

async function api(path) {
  const headers = {};
  const t = token();
  if (t) headers["Authorization"] = "Bearer " + t;
  const r = await fetch(path + (t ? (path.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(t) : ""), { headers });
  if (!r.ok) throw new Error("API " + r.status + " " + (await r.text()).slice(0, 200));
  return r.json();
}

function esc(s) { return String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

function spark(values, color) {
  const pts = values.filter(v => v !== null && v !== undefined);
  if (pts.length < 2) return '<svg class="spark"></svg>';
  const min = Math.min(...pts), max = Math.max(...pts);
  const span = max - min || 1;
  const w = 300, h = 48, pad = 4;
  const step = (w - pad * 2) / (values.length - 1);
  let d = "", started = false;
  values.forEach((v, i) => {
    if (v === null || v === undefined) return;
    const x = pad + i * step;
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    d += (started ? " L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
    started = true;
  });
  return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
    '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>';
}

function metricCard(name, latest, unit, series, color) {
  const val = latest === null || latest === undefined ? "—" : latest;
  return '<div class="card metric"><div class="name">' + esc(name) + '</div>' +
    '<div class="val">' + esc(val) + ' <small>' + esc(unit) + '</small></div>' +
    spark(series, color) + '</div>';
}

function render(d) {
  const app = document.getElementById("app");
  const hist = d.history || [];
  if (!hist.length) {
    app.innerHTML = '<div class="card empty">No data yet. Trigger a backfill or wait for the daily cron.</div>';
    return;
  }
  document.getElementById("updated").textContent = "Latest: " + (d.latest_date || "—");

  const lvl = d.strain ? d.strain.level : 0;
  const last = hist[hist.length - 1] || {};
  const series = k => hist.map(r => r[k]);

  let html = "";
  // Status
  html += '<div class="card status">' +
    '<div class="dot" style="background:' + COLORS[lvl] + '"></div>' +
    '<div><div class="label">' + esc(LEVEL_TEXT[lvl]) + '</div>' +
    '<div class="detail">' + esc((d.strain && d.strain.detail) || "") + '</div></div></div>';

  // Metrics
  html += '<h2>30-day trends</h2><div class="grid">';
  html += metricCard("Resting HR", last.night_rhr ?? last.sleep_rhr, "bpm", series("night_rhr"), "#5b8cff");
  html += metricCard("Sleep HRV", last.avg_sleep_hrv, "ms", series("avg_sleep_hrv"), "#2ecc71");
  html += metricCard("Temp deviation", last.temp_deviation, "°C", series("temp_deviation"), "#e74c3c");
  html += metricCard("Sleep score", last.sleep_score, "/100", series("sleep_score"), "#f1c40f");
  html += metricCard("Recovery", last.recovery_index, "/100", series("recovery_index"), "#9b59b6");
  html += metricCard("Total sleep", last.total_sleep_min, "min", series("total_sleep_min"), "#1abc9c");
  html += '</div>';

  // Report
  if (d.report) {
    html += '<h2>Today\\'s report</h2><pre class="report">' + esc(d.report) + '</pre>';
  }

  // Notification log
  html += '<h2>Notifications</h2>';
  const notes = d.notifications || [];
  if (!notes.length) {
    html += '<div class="card empty">No notifications logged yet.</div>';
  } else {
    html += '<div class="card"><table><thead><tr><th>Date</th><th>Level</th><th>Channel</th><th>Status</th></tr></thead><tbody>';
    for (const n of notes) {
      const st = n.delivered ? "✓ delivered" : (n.error ? '<span class="err">' + esc(n.error) + '</span>' : (n.channel ? "skipped" : "no webhook"));
      html += '<tr><td>' + esc(n.date) + '</td>' +
        '<td><span class="pill pill' + n.strain_level + '">' + esc(LEVEL_TEXT[n.strain_level]) + '</span></td>' +
        '<td>' + esc(n.channel || "—") + '</td>' +
        '<td>' + st + '</td></tr>';
    }
    html += '</tbody></table></div>';
  }

  app.innerHTML = html;
}

api("/api/dashboard").then(render).catch(e => {
  document.getElementById("app").innerHTML = '<div class="card empty err">' + esc(e.message) +
    '<br><br>If this is an auth error, append <code>?token=YOUR_DASHBOARD_TOKEN</code> to the URL.</div>';
});
</script>
</body>
</html>`;

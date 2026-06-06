import type { Env } from "./env.js";
import { DASHBOARD_HTML } from "./dashboard.js";
import {
  getRecent,
  getNotificationLog,
  countSnapshots,
  getAll,
} from "./db.js";
import { assessStrain } from "./strain.js";
import { runDaily } from "./pipeline.js";
import { backfill } from "./backfill.js";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/** Extract a bearer/`?token=` credential from the request. */
function credential(req: Request): string | null {
  const auth = req.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  const url = new URL(req.url);
  return url.searchParams.get("token");
}

function requireAdmin(req: Request, env: Env): Response | null {
  if (!env.ADMIN_TOKEN) {
    return json({ error: "ADMIN_TOKEN not configured; admin endpoints disabled." }, 503);
  }
  if (credential(req) !== env.ADMIN_TOKEN) {
    return json({ error: "Unauthorized" }, 401);
  }
  return null;
}

/** Read access: open unless DASHBOARD_TOKEN is set, in which case it's required. */
function requireRead(req: Request, env: Env): Response | null {
  if (!env.DASHBOARD_TOKEN) return null;
  if (credential(req) !== env.DASHBOARD_TOKEN) {
    return json({ error: "Unauthorized" }, 401);
  }
  return null;
}

export async function handleRequest(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method.toUpperCase();

  // ── Dashboard ──
  if (path === "/" || path === "/index.html") {
    const denied = requireRead(req, env);
    // For the HTML page we still serve the shell even when a token is required,
    // so the page can prompt for it; the API calls behind it enforce auth.
    if (denied && credential(req)) return denied;
    return new Response(DASHBOARD_HTML, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  if (path === "/api/health") {
    const count = await countSnapshots(env.DB).catch(() => -1);
    return json({
      ok: true,
      snapshots: count,
      hasToken: Boolean(env.ULTRAHUMAN_TOKEN),
      hasWebhook: Boolean(env.WEBHOOK_URL),
      time: new Date().toISOString(),
    });
  }

  // ── Aggregated payload for the dashboard ──
  if (path === "/api/dashboard") {
    const denied = requireRead(req, env);
    if (denied) return denied;
    const history = await getRecent(env.DB, 30);
    const strain = assessStrain(history);
    const notifications = await getNotificationLog(env.DB, 30);
    const latest = notifications.find((n) => n.report) ?? null;
    return json({
      latest_date: history.length ? history[history.length - 1].date : null,
      strain,
      history,
      report: latest?.report ?? null,
      notifications,
    });
  }

  if (path === "/api/history") {
    const denied = requireRead(req, env);
    if (denied) return denied;
    const days = parseInt(url.searchParams.get("days") ?? "30", 10);
    const rows = days >= 9999 ? await getAll(env.DB) : await getRecent(env.DB, days);
    return json({ days, count: rows.length, snapshots: rows });
  }

  if (path === "/api/strain") {
    const denied = requireRead(req, env);
    if (denied) return denied;
    const lookback = parseInt(url.searchParams.get("days") ?? "30", 10);
    const history = await getRecent(env.DB, lookback);
    return json({ strain: assessStrain(history), days: history.length });
  }

  // ── Admin: run the daily pipeline now ──
  if (path === "/api/run" && method === "POST") {
    const denied = requireAdmin(req, env);
    if (denied) return denied;
    try {
      const result = await runDaily(env, ctx);
      return json(result);
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // ── Admin: backfill history ──
  if (path === "/api/backfill" && method === "POST") {
    const denied = requireAdmin(req, env);
    if (denied) return denied;
    const days = parseInt(
      url.searchParams.get("days") ?? env.BACKFILL_DAYS ?? "35",
      10,
    );
    try {
      const result = await backfill(env, days);
      return json(result);
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  return json({ error: "Not found", path }, 404);
}

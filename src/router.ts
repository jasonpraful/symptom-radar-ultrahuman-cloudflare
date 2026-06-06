import type { Env } from "./env.js";
import { DASHBOARD_HTML } from "./dashboard.js";
import {
  getRecent,
  getNotificationLog,
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

/**
 * Constant-time string equality. Both sides are HMAC'd under a fresh random
 * per-call key — which equalises length (so no length oracle leaks) and lets us
 * compare fixed-size digests with the runtime's `timingSafeEqual`. Avoids the
 * early-exit timing side-channel of a plain `===` on the secret token.
 */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    crypto.getRandomValues(new Uint8Array(32)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const [ha, hb] = await Promise.all([
    crypto.subtle.sign("HMAC", key, enc.encode(a)),
    crypto.subtle.sign("HMAC", key, enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

async function requireAdmin(req: Request, env: Env): Promise<Response | null> {
  if (!env.ADMIN_TOKEN) {
    return json({ error: "ADMIN_TOKEN not configured; admin endpoints disabled." }, 503);
  }
  const cred = credential(req);
  if (cred === null || !(await safeEqual(cred, env.ADMIN_TOKEN))) {
    return json({ error: "Unauthorized" }, 401);
  }
  return null;
}

/** Read access: open unless DASHBOARD_TOKEN is set, in which case it's required. */
async function requireRead(req: Request, env: Env): Promise<Response | null> {
  if (!env.DASHBOARD_TOKEN) return null;
  const cred = credential(req);
  if (cred === null || !(await safeEqual(cred, env.DASHBOARD_TOKEN))) {
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
    // For the HTML page we still serve the shell even when a token is required,
    // so the page can prompt for it; the API calls behind it enforce auth.
    if (credential(req)) {
      const denied = await requireRead(req, env);
      if (denied) return denied;
    }
    return new Response(DASHBOARD_HTML, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // ── Aggregated payload for the dashboard ──
  if (path === "/api/dashboard") {
    const denied = await requireRead(req, env);
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
    const denied = await requireRead(req, env);
    if (denied) return denied;
    const days = parseInt(url.searchParams.get("days") ?? "30", 10);
    const rows = days >= 9999 ? await getAll(env.DB) : await getRecent(env.DB, days);
    return json({ days, count: rows.length, snapshots: rows });
  }

  if (path === "/api/strain") {
    const denied = await requireRead(req, env);
    if (denied) return denied;
    const lookback = parseInt(url.searchParams.get("days") ?? "30", 10);
    const history = await getRecent(env.DB, lookback);
    return json({ strain: assessStrain(history), days: history.length });
  }

  // ── Admin: run the daily pipeline now ──
  if (path === "/api/run" && method === "POST") {
    const denied = await requireAdmin(req, env);
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
    const denied = await requireAdmin(req, env);
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

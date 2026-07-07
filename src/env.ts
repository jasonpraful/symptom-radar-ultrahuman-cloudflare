/// <reference types="@cloudflare/workers-types" />

/**
 * Worker environment bindings.
 *
 * Secrets (set via `wrangler secret put <NAME>`):
 *  - ULTRAHUMAN_TOKEN : Ultrahuman Partner API token (Authorization header value).
 *
 * Vars (wrangler.jsonc):
 *  - ULTRAHUMAN_EMAIL : ring owner's email, sent as the `email` query param (required).
 *  - WEBHOOK_URL      : Destination for strain notifications (Slack/Discord/generic).
 *  - ADMIN_TOKEN      : Bearer token guarding admin endpoints (/api/backfill, /api/run).
 *  - DASHBOARD_TOKEN  : Optional bearer/`?token=` guard for the dashboard + read APIs.
 *                       If unset, the dashboard is publicly readable.
 *
 * Vars (wrangler.jsonc):
 *  - WEBHOOK_FORMAT   : "slack" | "discord" | "generic" | "auto"
 *  - NOTIFY_ON_LEVELS : comma-separated strain levels that trigger a webhook, e.g. "1,2"
 *  - BACKFILL_DAYS    : default backfill window (string int)
 */
export interface Env {
  DB: D1Database;

  ULTRAHUMAN_TOKEN: string;
  ULTRAHUMAN_EMAIL: string;
  WEBHOOK_URL?: string;
  ADMIN_TOKEN?: string;
  DASHBOARD_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;

  WEBHOOK_FORMAT?: string;
  NOTIFY_ON_LEVELS?: string;
  BACKFILL_DAYS?: string;
}

import type { Env } from "./env.js";
import type { StrainResult } from "./types.js";

export type WebhookFormat = "slack" | "discord" | "generic";

/** Resolve the webhook payload format from config / URL host. */
export function resolveFormat(env: Env): WebhookFormat {
  const explicit = (env.WEBHOOK_FORMAT ?? "auto").toLowerCase();
  if (explicit === "slack" || explicit === "discord" || explicit === "generic") {
    return explicit;
  }
  // auto-detect from URL
  const url = env.WEBHOOK_URL ?? "";
  if (url.includes("hooks.slack.com")) return "slack";
  if (url.includes("discord.com/api/webhooks") || url.includes("discordapp.com/api/webhooks")) {
    return "discord";
  }
  return "generic";
}

const LEVEL_TITLE: Record<number, string> = {
  0: "✅ Symptom Radar: No signs",
  1: "⚠️ Symptom Radar: Minor signs",
  2: "🔴 Symptom Radar: Major signs",
};

function buildBody(
  format: WebhookFormat,
  report: string,
  strain: StrainResult,
  date: string,
): string {
  switch (format) {
    case "slack":
      // Slack renders mrkdwn; the report's `##`/`**` are close enough, but Slack
      // prefers `*bold*`. We send the markdown in a code-free text block.
      return JSON.stringify({
        text: `${LEVEL_TITLE[strain.level]} — ${date}`,
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: slackify(report) },
          },
        ],
      });
    case "discord":
      // Discord embeds cap description at 4096 chars; the report is well under.
      return JSON.stringify({
        username: "Symptom Radar",
        embeds: [
          {
            title: LEVEL_TITLE[strain.level],
            description: report,
            color: [0x2ecc71, 0xf1c40f, 0xe74c3c][strain.level],
            footer: { text: `Ultrahuman • ${date}` },
          },
        ],
      });
    case "generic":
    default:
      return JSON.stringify({
        date,
        strain_level: strain.level,
        strain_detail: strain.detail,
        report,
      });
  }
}

/** Convert the GitHub-flavoured markdown report to Slack mrkdwn (best-effort). */
function slackify(report: string): string {
  return report
    .replace(/^## (.*)$/gm, "*$1*")
    .replace(/\*\*(.+?)\*\*/g, "*$1*");
}

export interface DeliveryResult {
  attempted: boolean;
  delivered: boolean;
  channel: WebhookFormat | null;
  status?: number;
  error?: string;
}

/** Strain levels (parsed from NOTIFY_ON_LEVELS) that should trigger a webhook. */
export function notifyLevels(env: Env): Set<number> {
  const raw = env.NOTIFY_ON_LEVELS ?? "1,2";
  const set = new Set<number>();
  for (const part of raw.split(",")) {
    const n = parseInt(part.trim(), 10);
    if (!Number.isNaN(n)) set.add(n);
  }
  return set;
}

/**
 * Deliver a strain report to the configured webhook. No-op (attempted=false)
 * when no WEBHOOK_URL is configured or the level is below the notify threshold.
 */
export async function deliverNotification(
  env: Env,
  report: string,
  strain: StrainResult,
  date: string,
  opts: { force?: boolean } = {},
): Promise<DeliveryResult> {
  if (!env.WEBHOOK_URL) {
    return { attempted: false, delivered: false, channel: null };
  }
  if (!opts.force && !notifyLevels(env).has(strain.level)) {
    return { attempted: false, delivered: false, channel: null };
  }

  const format = resolveFormat(env);
  const body = buildBody(format, report, strain, date);

  try {
    const resp = await fetch(env.WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      return {
        attempted: true,
        delivered: false,
        channel: format,
        status: resp.status,
        error: txt.slice(0, 300),
      };
    }
    return { attempted: true, delivered: true, channel: format, status: resp.status };
  } catch (err) {
    return {
      attempted: true,
      delivered: false,
      channel: format,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

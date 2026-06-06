import type { Env } from "./env.js";
import { handleRequest } from "./router.js";
import { runDaily } from "./pipeline.js";

export default {
  /** HTTP entrypoint: dashboard + JSON API + admin actions. */
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await handleRequest(req, env, ctx);
    } catch (err) {
      return new Response(
        JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },

  /**
   * Cron Triggers entrypoint — replaces the original `cron + python3 symptom_radar.py`.
   * Runs the daily fetch → store → assess → notify pipeline on the schedule
   * configured in wrangler.jsonc (`triggers.crons`).
   */
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const run = runDaily(env, ctx)
      .then((r) => {
        console.log(
          `[cron ${event.cron}] ${r.date} level=${r.strain_level} ` +
            `notified=${r.notification.delivered} channel=${r.notification.channel ?? "-"}`,
        );
      })
      .catch((err) => {
        console.error(`[cron ${event.cron}] failed:`, err instanceof Error ? err.stack : err);
        throw err;
      });
    ctx.waitUntil(run);
    await run;
  },
};

import type { Env } from "./env.js";
import { runDailyPipeline } from "./report.js";
import { deliverNotification } from "./notify.js";
import { logNotification } from "./db.js";

export interface RunResult {
  date: string;
  strain_level: number;
  strain_detail: string;
  report: string;
  notification: {
    attempted: boolean;
    delivered: boolean;
    channel: string | null;
    status?: number;
    error?: string;
  };
}

/**
 * The full daily job: fetch → store → assess → notify → log.
 * Shared by the Cron `scheduled` handler and the `POST /api/run` admin endpoint.
 *
 * `opts.force` forces webhook delivery regardless of NOTIFY_ON_LEVELS (handy for
 * the manual admin run / testing the integration).
 */
export async function runDaily(
  env: Env,
  _ctx: ExecutionContext,
  opts: { force?: boolean } = {},
): Promise<RunResult> {
  const result = await runDailyPipeline(env);
  const delivery = await deliverNotification(
    env,
    result.report,
    result.strain,
    result.date,
    { force: opts.force },
  );

  await logNotification(env.DB, {
    date: result.date,
    strain_level: result.strain.level,
    detail: result.strain.detail,
    report: result.report,
    channel: delivery.channel,
    delivered: delivery.delivered,
    error: delivery.error ?? null,
  });

  return {
    date: result.date,
    strain_level: result.strain.level,
    strain_detail: result.strain.detail,
    report: result.report,
    notification: delivery,
  };
}

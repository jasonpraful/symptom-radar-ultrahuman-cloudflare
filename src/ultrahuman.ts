import type { UltrahumanMetric, UltrahumanResponse } from "./types.js";

// Live Ultrahuman Partner API. Requires an `email` query param identifying the
// ring owner and the token verbatim in the `Authorization` header. Returns one
// day's metrics as `data.metric_data` (an array of { type, object }).
export const BASE_URL = "https://partner.ultrahuman.com/api/v1/metrics";

export class UltrahumanError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "UltrahumanError";
  }
}

/**
 * The Partner API expects the token verbatim in the `Authorization` header
 * (no "Bearer " prefix) — identical to the Python implementation.
 */
function authHeaders(token: string): HeadersInit {
  return { Authorization: token };
}

async function getJson(
  url: string,
  token: string,
  timeoutMs = 15000,
): Promise<UltrahumanResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: authHeaders(token),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new UltrahumanError(
        `Ultrahuman API ${resp.status}: ${body.slice(0, 300)}`,
        resp.status,
      );
    }
    return (await resp.json()) as UltrahumanResponse;
  } catch (err) {
    if (err instanceof UltrahumanError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new UltrahumanError(`Ultrahuman API request timed out after ${timeoutMs}ms`);
    }
    throw new UltrahumanError(
      `Ultrahuman API request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/** GET one day's metrics — `?email=<owner>&date=YYYY-MM-DD`. */
export function fetchDay(
  token: string,
  email: string,
  dateStr: string,
): Promise<UltrahumanResponse> {
  const url = `${BASE_URL}?email=${encodeURIComponent(email)}&date=${encodeURIComponent(dateStr)}`;
  return getJson(url, token);
}

/**
 * Normalize a response into a day's metric array, tolerating both the live
 * `data.metric_data` (flat array for the requested day) and the legacy
 * `data.metrics[date]` (date-keyed map) shapes.
 */
export function metricsFor(
  resp: UltrahumanResponse,
  dateStr: string,
): UltrahumanMetric[] {
  return resp.data?.metric_data ?? resp.data?.metrics?.[dateStr] ?? [];
}

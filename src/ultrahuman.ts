import type { UltrahumanResponse } from "./types.js";

export const BASE_URL =
  "https://partner.ultrahuman.com/api/v1/partner/daily_metrics";

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

/** Equivalent of Python `fetch_day(date_str)` — GET ?date=YYYY-MM-DD. */
export function fetchDay(token: string, dateStr: string): Promise<UltrahumanResponse> {
  const url = `${BASE_URL}?date=${encodeURIComponent(dateStr)}`;
  return getJson(url, token);
}

/** Equivalent of Python `fetch_range(start_epoch, end_epoch)`. */
export function fetchRange(
  token: string,
  startEpoch: number,
  endEpoch: number,
): Promise<UltrahumanResponse> {
  const url = `${BASE_URL}?start_epoch=${Math.trunc(startEpoch)}&end_epoch=${Math.trunc(endEpoch)}`;
  return getJson(url, token);
}

/**
 * Number-formatting helpers that mirror Python's rendering, so the Cloudflare
 * port produces the same human-readable strings as the original.
 *
 * Both Python's `round(x, 1)` and its `f"{x:.1f}"` formatting round half to even
 * on the *true* value of the double. Naively scaling by 10 first (`x * 10`)
 * introduces representation error (e.g. `0.35 * 10 === 3.5000000000000004`), so
 * we lean on `toFixed` — which does correct shortest rounding — and only hand-roll
 * the exact-tie case, which can only occur when `x` is an odd multiple of 0.25
 * (and for those, `x * 10` happens to be exact).
 */

/** Equivalent of Python `round(x, 1)`, round-half-to-even on the true value. */
export function round1HalfEven(x: number): number {
  if (Number.isInteger(x * 4) && !Number.isInteger(x * 2)) {
    // x is an odd multiple of 0.25 → exact tie at the 1-decimal place.
    const lower = Math.floor(x * 10); // exact here
    const evenTenth = lower % 2 === 0 ? lower : lower + 1;
    return evenTenth / 10;
  }
  return parseFloat(x.toFixed(1));
}

/**
 * Format like Python `f"{x:+.1f}"` — forced sign, one decimal, round half to even,
 * including Python's signed-zero behaviour (`-0.04` → `"-0.0"`).
 */
export function signed1(x: number): string {
  const r = round1HalfEven(x);
  const negative = r < 0 || (r === 0 && (x < 0 || Object.is(x, -0)));
  return (negative ? "-" : "+") + Math.abs(r).toFixed(1);
}

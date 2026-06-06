import { describe, it, expect } from "vitest";
import { round1HalfEven, signed1 } from "../src/format.js";

describe("round1HalfEven (Python round(x, 1) parity)", () => {
  it("rounds non-ties to the nearest tenth", () => {
    expect(round1HalfEven(72.36)).toBe(72.4);
    expect(round1HalfEven(72.34)).toBe(72.3);
    expect(round1HalfEven(0.35)).toBe(0.3); // 0.35 is really 0.34999… → down
  });

  it("rounds exact quarter-ties half to even", () => {
    expect(round1HalfEven(0.25)).toBe(0.2); // tie → even (2)
    expect(round1HalfEven(0.75)).toBe(0.8); // tie → even (8)
    expect(round1HalfEven(1.25)).toBe(1.2);
    expect(round1HalfEven(-0.25)).toBe(-0.2);
  });
});

describe("signed1 (Python f\"{x:+.1f}\" parity)", () => {
  it("forces a sign and one decimal", () => {
    expect(signed1(0.2)).toBe("+0.2");
    expect(signed1(-0.2)).toBe("-0.2");
    expect(signed1(1)).toBe("+1.0");
  });

  it("rounds half to even like Python", () => {
    expect(signed1(0.25)).toBe("+0.2");
    expect(signed1(-0.25)).toBe("-0.2");
    expect(signed1(0.35)).toBe("+0.3");
  });

  it("preserves signed zero", () => {
    expect(signed1(-0.04)).toBe("-0.0");
    expect(signed1(0)).toBe("+0.0");
  });
});

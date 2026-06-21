import { describe, it, expect } from "vitest";
import { clamp, lerp } from "../src/core/math";

describe("clamp", () => {
  it("leaves an in-range value untouched", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("clamps below the minimum and above the maximum", () => {
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
});

describe("lerp", () => {
  it("returns the endpoints at t=0 and t=1", () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 1)).toBe(20);
  });

  it("interpolates the midpoint and clamps out-of-range t", () => {
    expect(lerp(10, 20, 0.5)).toBe(15);
    expect(lerp(10, 20, 2)).toBe(20);
  });
});

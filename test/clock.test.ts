import { describe, it, expect } from "vitest";
import { planSubsteps, FIXED_DT } from "../src/sim/clock.ts";

describe("planSubsteps", () => {
  it("runs whole fixed steps and carries the remainder", () => {
    // 0.05 s at FIXED_DT 0.02 -> 2 steps, 0.01 left.
    const p = planSubsteps(0, 0.05);
    expect(p.steps).toBe(2);
    expect(p.remainder).toBeCloseTo(0.01, 6);
  });

  it("accumulates leftover time across frames", () => {
    const a = planSubsteps(0, 0.015); // 0 steps, 0.015 carried
    expect(a.steps).toBe(0);
    const b = planSubsteps(a.remainder, 0.015); // 0.03 total -> 1 step
    expect(b.steps).toBe(1);
    expect(b.remainder).toBeCloseTo(0.01, 6);
  });

  it("scales step count with the speed multiplier", () => {
    const realDt = 0.016;
    const at1 = planSubsteps(0, realDt * 1).steps;
    const at10 = planSubsteps(0, realDt * 10).steps;
    expect(at10).toBeGreaterThan(at1);
    expect(at10).toBe(Math.floor((realDt * 10) / FIXED_DT));
  });

  it("caps runaway time so we never simulate unbounded work", () => {
    const p = planSubsteps(0, 100, FIXED_DT, 240);
    expect(p.steps).toBe(240);
    expect(p.remainder).toBe(0); // backlog dropped, not carried
  });

  it("conserves time when under the cap (steps*dt + remainder == input)", () => {
    const elapsed = 0.137;
    const p = planSubsteps(0, elapsed);
    expect(p.steps * FIXED_DT + p.remainder).toBeCloseTo(elapsed, 9);
  });
});

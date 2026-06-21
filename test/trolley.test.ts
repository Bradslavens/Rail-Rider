import { describe, it, expect } from "vitest";
import {
  stepTrolley,
  DEFAULT_PARAMS,
  type ControlInput,
  type TrolleyState,
} from "../src/sim/trolley.ts";

const LENGTH = 1000;
const idle: ControlInput = { throttle: 0, brake: 0, reverse: false };

function run(
  state: TrolleyState,
  input: ControlInput,
  seconds: number,
  dt = 0.1,
): TrolleyState {
  let s = state;
  for (let t = 0; t < seconds; t += dt) {
    s = stepTrolley(s, DEFAULT_PARAMS, input, dt, LENGTH);
  }
  return s;
}

describe("stepTrolley", () => {
  it("accelerates forward under throttle", () => {
    const out = run({ s: 100, v: 0 }, { ...idle, throttle: 1 }, 2);
    expect(out.v).toBeGreaterThan(1);
    expect(out.s).toBeGreaterThan(100);
  });

  it("reverses when reverse is engaged", () => {
    const out = run({ s: 100, v: 0 }, { ...idle, throttle: 1, reverse: true }, 2);
    expect(out.v).toBeLessThan(0);
    expect(out.s).toBeLessThan(100);
  });

  it("brakes to a stop without rolling backwards", () => {
    const out = run({ s: 100, v: 10 }, { ...idle, brake: 1 }, 30);
    expect(out.v).toBe(0);
  });

  it("clamps to the maximum speed", () => {
    // 40s reaches top speed (~29s) while staying well short of the line end.
    const out = run({ s: 0, v: 0 }, { ...idle, throttle: 1 }, 40);
    expect(out.v).toBeLessThanOrEqual(DEFAULT_PARAMS.maxSpeed + 1e-9);
    expect(out.v).toBeGreaterThan(DEFAULT_PARAMS.maxSpeed - 1);
  });

  it("coasts down due to drag", () => {
    const out = run({ s: 100, v: 20 }, idle, 5);
    expect(out.v).toBeLessThan(20);
    expect(out.v).toBeGreaterThan(0);
  });

  it("stops hard at the end of the line", () => {
    const out = run({ s: LENGTH - 5, v: 20 }, { ...idle, throttle: 1 }, 5);
    expect(out.s).toBe(LENGTH);
    expect(out.v).toBe(0);
  });

  it("stops hard at the start when reversing past zero", () => {
    const out = run({ s: 3, v: -10 }, idle, 5);
    expect(out.s).toBe(0);
    expect(out.v).toBe(0);
  });
});

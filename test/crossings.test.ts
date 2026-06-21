import { describe, it, expect } from "vitest";
import { gateClosed, DEFAULT_CROSSING } from "../src/sim/crossings.ts";

describe("gateClosed", () => {
  const A = DEFAULT_CROSSING.approachM;

  it("closes the gates while the train is within the approach window", () => {
    expect(gateClosed(1000, 1000, A)).toBe(true);
    expect(gateClosed(1000 - A + 1, 1000, A)).toBe(true);
    expect(gateClosed(1000 + A - 1, 1000, A)).toBe(true);
  });

  it("opens the gates outside the window", () => {
    expect(gateClosed(1000 - A - 1, 1000, A)).toBe(false);
    expect(gateClosed(2000, 1000, A)).toBe(false);
  });

  it("is symmetric (works in either travel direction)", () => {
    expect(gateClosed(1000 - 50, 1000, A)).toBe(gateClosed(1000 + 50, 1000, A));
  });
});

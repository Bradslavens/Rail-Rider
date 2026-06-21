import { describe, it, expect } from "vitest";
import { SpeedLimitProfile, type SpeedLimitParams } from "../src/sim/speedLimit.ts";
import type { TrackPoint } from "../src/core/types.ts";

const PARAMS: SpeedLimitParams = { lateralAccel: 1.2, maxSpeed: 24.4, lookaheadM: 0 };

function straight(n: number, spacing = 5): TrackPoint[] {
  const pts: TrackPoint[] = [];
  for (let i = 0; i < n; i++) pts.push({ x: i * spacing, z: 0, dist: i * spacing });
  return pts;
}

/** Quarter arc of a circle of radius R, sampled every ~`step` metres. */
function arc(R: number, step = 5): TrackPoint[] {
  const dTheta = step / R;
  const pts: TrackPoint[] = [];
  let dist = 0;
  let prevX = R;
  let prevZ = 0;
  for (let theta = 0; theta <= Math.PI / 2 + 1e-9; theta += dTheta) {
    const x = R * Math.cos(theta);
    const z = R * Math.sin(theta);
    if (pts.length > 0) dist += Math.hypot(x - prevX, z - prevZ);
    pts.push({ x, z, dist });
    prevX = x;
    prevZ = z;
  }
  return pts;
}

describe("SpeedLimitProfile", () => {
  it("imposes no restriction on a straight track", () => {
    const profile = new SpeedLimitProfile(straight(10), PARAMS);
    for (let s = 0; s < 45; s += 5) {
      expect(profile.limitAt(s)).toBeCloseTo(PARAMS.maxSpeed, 6);
    }
  });

  it("limits curve speed to sqrt(a_lat * R)", () => {
    const R = 200;
    const expected = Math.sqrt(PARAMS.lateralAccel * R); // ≈ 15.49 m/s
    const profile = new SpeedLimitProfile(arc(R), PARAMS);
    // Sample well inside the arc (away from the maxSpeed endpoints).
    const mid = profile.limitAt(150);
    expect(mid).toBeGreaterThan(expected - 1.5);
    expect(mid).toBeLessThan(expected + 1.5);
    expect(mid).toBeLessThan(PARAMS.maxSpeed);
  });

  it("looks ahead so the limit drops before the curve is reached", () => {
    // Straight run of 100 m, then a tight curve.
    const lead: TrackPoint[] = straight(21); // 0..100 m
    const curve = arc(120, 5).map((p) => ({
      x: 100 + (120 - p.x), // tack the curve onto the end of the straight
      z: p.z,
      dist: 100 + p.dist,
    }));
    const pts = [...lead, ...curve.slice(1)];
    const noLook = new SpeedLimitProfile(pts, { ...PARAMS, lookaheadM: 0 });
    const withLook = new SpeedLimitProfile(pts, { ...PARAMS, lookaheadM: 160 });
    // At s=40 the curve is ~60 m ahead: lookahead should already be braking.
    expect(noLook.limitAt(40)).toBeCloseTo(PARAMS.maxSpeed, 4);
    expect(withLook.limitAt(40)).toBeLessThan(PARAMS.maxSpeed);
  });
});

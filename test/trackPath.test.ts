import { describe, it, expect } from "vitest";
import { TrackPath } from "../src/sim/trackPath.ts";

// An L-shaped track: 10m east, then 10m north. dist is cumulative arc length.
// TrackPath samples through a Catmull-Rom spline, so the corner is rounded but
// every listed point is still passed through exactly.
const points = [
  { x: 0, z: 0, dist: 0 },
  { x: 10, z: 0, dist: 10 },
  { x: 10, z: 10, dist: 20 },
];

describe("TrackPath", () => {
  const path = new TrackPath(points);

  it("exposes total length", () => {
    expect(path.length).toBe(20);
  });

  it("passes through every track point exactly", () => {
    expect(path.positionAt(0)).toEqual({ x: 0, z: 0 });
    expect(path.positionAt(10)).toEqual({ x: 10, z: 0 });
    expect(path.positionAt(20)).toEqual({ x: 10, z: 10 });
  });

  it("stays exactly linear on straight runs", () => {
    const straight = new TrackPath([
      { x: 0, z: 0, dist: 0 },
      { x: 10, z: 0, dist: 10 },
      { x: 20, z: 0, dist: 20 },
    ]);
    expect(straight.positionAt(5).x).toBeCloseTo(5, 9);
    expect(straight.positionAt(5).z).toBeCloseTo(0, 9);
    expect(straight.positionAt(15).x).toBeCloseTo(15, 9);
    expect(straight.tangentAt(3)).toEqual({ x: 1, z: 0 });
  });

  it("rounds corners smoothly but stays near the polyline", () => {
    // Mid-segment near a 90° corner: pulled toward the inside, bounded.
    const p = path.positionAt(5);
    expect(p.x).toBeGreaterThan(4);
    expect(p.x).toBeLessThan(6);
    expect(Math.abs(p.z)).toBeLessThan(1.5);
  });

  it("clamps out-of-range positions to the ends", () => {
    expect(path.positionAt(-5)).toEqual({ x: 0, z: 0 });
    expect(path.positionAt(999)).toEqual({ x: 10, z: 10 });
  });

  it("always returns a unit tangent", () => {
    for (const s of [0, 3, 9.9, 10, 10.1, 15, 20]) {
      const t = path.tangentAt(s);
      expect(Math.hypot(t.x, t.z)).toBeCloseTo(1, 9);
    }
  });

  it("turns the tangent continuously through a corner", () => {
    // At the corner node the tangent must average the two legs (no snap),
    // and approaching from either side must agree with it.
    expect(path.headingAt(10)).toBeCloseTo(Math.PI / 4, 6);
    const before = path.headingAt(9.999);
    const after = path.headingAt(10.001);
    expect(Math.abs(before - after)).toBeLessThan(0.01);
  });

  it("reports heading as a yaw angle", () => {
    // Deep in the straight legs the heading is near the leg direction (on
    // this tiny 3-point track the corner's spline influence spans the whole
    // leg, so allow a few degrees).
    expect(Math.abs(path.headingAt(1) - Math.PI / 2)).toBeLessThan(0.1);
    expect(Math.abs(path.headingAt(19))).toBeLessThan(0.1);
  });

  it("densifies into points on the smooth curve", () => {
    const samples = path.samplePoints(2.5);
    expect(samples[0]).toEqual({ x: 0, z: 0, dist: 0 });
    expect(samples[samples.length - 1]).toEqual({ x: 10, z: 10, dist: 20 });
    // Monotonic dist, spacing respected.
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i].dist).toBeGreaterThan(samples[i - 1].dist);
    }
  });

  it("rejects degenerate tracks", () => {
    expect(() => new TrackPath([{ x: 0, z: 0, dist: 0 }])).toThrow();
  });
});

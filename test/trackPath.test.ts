import { describe, it, expect } from "vitest";
import { TrackPath } from "../src/sim/trackPath.ts";

// An L-shaped track: 10m east, then 10m "north" (-z is forward earlier; here we
// just use raw coords). dist is cumulative arc length.
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

  it("returns endpoints at s=0 and s=length", () => {
    expect(path.positionAt(0)).toEqual({ x: 0, z: 0 });
    expect(path.positionAt(20)).toEqual({ x: 10, z: 10 });
  });

  it("interpolates within a segment", () => {
    expect(path.positionAt(5)).toEqual({ x: 5, z: 0 });
    expect(path.positionAt(15)).toEqual({ x: 10, z: 5 });
  });

  it("clamps out-of-range positions to the ends", () => {
    expect(path.positionAt(-5)).toEqual({ x: 0, z: 0 });
    expect(path.positionAt(999)).toEqual({ x: 10, z: 10 });
  });

  it("gives a unit tangent along the current segment", () => {
    expect(path.tangentAt(3)).toEqual({ x: 1, z: 0 });
    expect(path.tangentAt(15)).toEqual({ x: 0, z: 1 });
  });

  it("reports heading as a yaw angle", () => {
    // facing +x (east) -> atan2(1,0) = PI/2
    expect(path.headingAt(3)).toBeCloseTo(Math.PI / 2, 6);
    // facing +z -> atan2(0,1) = 0
    expect(path.headingAt(15)).toBeCloseTo(0, 6);
  });

  it("rejects degenerate tracks", () => {
    expect(() => new TrackPath([{ x: 0, z: 0, dist: 0 }])).toThrow();
  });
});

import { describe, it, expect } from "vitest";
import { placeSignals, SIGNAL_OFFSET_M } from "../src/sim/signals.ts";
import { TrackPath } from "../src/sim/trackPath.ts";
import type { Signal, TrackPoint } from "../src/core/types.ts";

// Straight track running east along +x, 100 m long.
function straightPath(): TrackPath {
  const pts: TrackPoint[] = [];
  for (let i = 0; i <= 20; i++) pts.push({ x: i * 5, z: 0, dist: i * 5 });
  return new TrackPath(pts);
}

const sig = (over: Partial<Signal> = {}): Signal => ({
  id: "s1",
  name: "E1",
  shapeId: "shapeA",
  distM: 50,
  side: "R",
  aspect: "green",
  ...over,
});

describe("placeSignals", () => {
  const paths = new Map([["shapeA", straightPath()]]);

  it("places a signal beside the track at its arc-length position", () => {
    const [p] = placeSignals([sig()], paths);
    expect(p.x).toBeCloseTo(50, 6);
    expect(Math.abs(p.z)).toBeCloseTo(SIGNAL_OFFSET_M, 6); // offset to one side
    expect(p).toMatchObject({ id: "s1", name: "E1", aspect: "green" });
  });

  it("puts L and R signals on opposite sides of the centreline", () => {
    const [r] = placeSignals([sig({ side: "R" })], paths);
    const [l] = placeSignals([sig({ side: "L" })], paths);
    expect(Math.sign(r.z)).toBe(-Math.sign(l.z));
    expect(r.z).toBeCloseTo(-l.z, 6);
  });

  it("faces the head against the direction of travel", () => {
    // Travel is +x, so the head should look back toward -x: yaw = atan2(-1, 0).
    const [p] = placeSignals([sig()], paths);
    expect(p.headingRad).toBeCloseTo(Math.atan2(-1, 0), 6);
  });

  it("skips signals whose shape has no path", () => {
    const out = placeSignals([sig({ shapeId: "missing" })], paths);
    expect(out).toHaveLength(0);
  });

  it("clamps an out-of-range distM onto the track", () => {
    const [p] = placeSignals([sig({ distM: 9999 })], paths);
    expect(p.x).toBeCloseTo(100, 6); // end of the 100 m track
  });
});

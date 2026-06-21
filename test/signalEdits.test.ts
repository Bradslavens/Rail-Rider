import { describe, it, expect } from "vitest";
import {
  nearestOnPath,
  nextSignalId,
  addSignal,
  updateSignal,
  deleteSignal,
} from "../src/edit/signalEdits.ts";
import type { Signal, TrackPoint } from "../src/core/types.ts";

// Straight track east along +x, 100 m.
const straight: TrackPoint[] = Array.from({ length: 21 }, (_, i) => ({
  x: i * 5,
  z: 0,
  dist: i * 5,
}));

const sig = (over: Partial<Signal> = {}): Signal => ({
  id: "s1",
  name: "E1",
  shapeId: "shapeA",
  distM: 10,
  side: "R",
  aspect: "green",
  ...over,
});

describe("nearestOnPath", () => {
  it("snaps a point to the arc-length of the nearest centreline point", () => {
    const r = nearestOnPath(straight, 52, 7);
    expect(r.distM).toBeCloseTo(52, 6);
    expect(r.x).toBeCloseTo(52, 6);
    expect(r.z).toBeCloseTo(0, 6);
  });

  it("reports opposite sides for points either side of the track", () => {
    const right = nearestOnPath(straight, 50, 7);
    const left = nearestOnPath(straight, 50, -7);
    expect(right.side).not.toBe(left.side);
  });

  it("clamps a point beyond the end onto the track", () => {
    const r = nearestOnPath(straight, 999, 3);
    expect(r.distM).toBeCloseTo(100, 6);
  });
});

describe("signal CRUD reducers", () => {
  it("adds without mutating the original list", () => {
    const list = [sig()];
    const out = addSignal(list, sig({ id: "s2" }));
    expect(out).toHaveLength(2);
    expect(list).toHaveLength(1);
  });

  it("updates fields but never the id", () => {
    const out = updateSignal([sig()], "s1", { name: "E99", aspect: "red", id: "hacked" } as Partial<Signal>);
    expect(out[0]).toMatchObject({ id: "s1", name: "E99", aspect: "red" });
  });

  it("deletes by id", () => {
    const out = deleteSignal([sig(), sig({ id: "s2" })], "s1");
    expect(out.map((s) => s.id)).toEqual(["s2"]);
  });

  it("generates a unique id for a shape", () => {
    const id = nextSignalId([sig({ id: "shapeA-sig-1" })], "shapeA");
    expect(id).not.toBe("shapeA-sig-1");
    expect(id.startsWith("shapeA-sig-")).toBe(true);
  });
});

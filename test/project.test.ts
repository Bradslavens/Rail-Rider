import { describe, it, expect } from "vitest";
import { projectToPolyline } from "../pipeline/src/project.ts";

const track = [
  { x: 0, z: 0 },
  { x: 10, z: 0 },
  { x: 10, z: 10 },
];

describe("projectToPolyline", () => {
  it("projects a point beside the first segment", () => {
    const proj = projectToPolyline({ x: 3, z: 2 }, track);
    expect(proj.distAlong).toBeCloseTo(3, 6);
    expect(proj.offset).toBeCloseTo(2, 6);
    expect(proj.segmentIndex).toBe(0);
    expect(proj.point).toEqual({ x: 3, z: 0 });
  });

  it("projects a point beside the second segment", () => {
    const proj = projectToPolyline({ x: 7, z: 6 }, track);
    // nearest track point is (10,6): 10 along first seg + 6 along second
    expect(proj.distAlong).toBeCloseTo(16, 6);
    expect(proj.offset).toBeCloseTo(3, 6);
    expect(proj.segmentIndex).toBe(1);
  });

  it("clamps to the start when the point is before the line", () => {
    const proj = projectToPolyline({ x: -5, z: 0 }, track);
    expect(proj.distAlong).toBeCloseTo(0, 6);
    expect(proj.point).toEqual({ x: 0, z: 0 });
  });
});

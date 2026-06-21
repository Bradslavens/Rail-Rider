import { describe, it, expect } from "vitest";
import {
  dedupe,
  cumulativeLengths,
  totalLength,
  resample,
} from "../pipeline/src/polyline.ts";

describe("dedupe", () => {
  it("removes consecutive near-duplicate points", () => {
    const out = dedupe([
      { x: 0, z: 0 },
      { x: 0.001, z: 0 },
      { x: 10, z: 0 },
    ]);
    expect(out).toHaveLength(2);
  });
});

describe("cumulativeLengths / totalLength", () => {
  it("accumulates segment lengths", () => {
    const pts = [
      { x: 0, z: 0 },
      { x: 3, z: 0 },
      { x: 3, z: 4 },
    ];
    expect(cumulativeLengths(pts)).toEqual([0, 3, 7]);
    expect(totalLength(pts)).toBe(7);
  });
});

describe("resample", () => {
  it("produces evenly spaced points along a straight line", () => {
    const out = resample(
      [
        { x: 0, z: 0 },
        { x: 10, z: 0 },
      ],
      2,
    );
    // points at 0,2,4,6,8,10
    expect(out).toHaveLength(6);
    expect(out[0].x).toBeCloseTo(0, 9);
    expect(out[3].x).toBeCloseTo(6, 9);
    expect(out[out.length - 1].x).toBeCloseTo(10, 9);
  });

  it("always keeps the final point even when spacing doesn't divide evenly", () => {
    const out = resample(
      [
        { x: 0, z: 0 },
        { x: 10, z: 0 },
      ],
      3,
    );
    expect(out[out.length - 1].x).toBeCloseTo(10, 9);
  });

  it("follows a corner", () => {
    const out = resample(
      [
        { x: 0, z: 0 },
        { x: 4, z: 0 },
        { x: 4, z: 4 },
      ],
      1,
    );
    // 5 units in, we should have turned the corner onto the second segment
    expect(out[5].x).toBeCloseTo(4, 6);
    expect(out[5].z).toBeCloseTo(1, 6);
  });
});

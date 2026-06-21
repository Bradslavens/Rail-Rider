import { describe, it, expect } from "vitest";
import { centroid, project } from "../pipeline/src/geo.ts";

const origin = { lat: 32.7157, lon: -117.1611 }; // downtown San Diego-ish

describe("centroid", () => {
  it("averages lat/lon", () => {
    const c = centroid([
      { lat: 0, lon: 0 },
      { lat: 10, lon: 20 },
    ]);
    expect(c.lat).toBeCloseTo(5, 9);
    expect(c.lon).toBeCloseTo(10, 9);
  });

  it("throws on an empty set", () => {
    expect(() => centroid([])).toThrow();
  });
});

describe("project", () => {
  it("maps the origin to (0,0)", () => {
    const o = project(origin, origin);
    expect(o.x).toBeCloseTo(0, 9);
    expect(o.z).toBeCloseTo(0, 9);
  });

  it("sends North to negative Z and East to positive X", () => {
    const north = project({ lat: origin.lat + 0.01, lon: origin.lon }, origin);
    const east = project({ lat: origin.lat, lon: origin.lon + 0.01 }, origin);
    expect(north.z).toBeLessThan(0);
    expect(north.x).toBeCloseTo(0, 6);
    expect(east.x).toBeGreaterThan(0);
    expect(east.z).toBeCloseTo(0, 6);
  });

  it("yields a plausible metric scale (~1.1 km per 0.01° lat)", () => {
    const north = project({ lat: origin.lat + 0.01, lon: origin.lon }, origin);
    expect(Math.abs(north.z)).toBeGreaterThan(1000);
    expect(Math.abs(north.z)).toBeLessThan(1200);
  });
});

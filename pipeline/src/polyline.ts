// Pure polyline helpers operating on world-meter points: cleaning, arc-length
// measurement, and even-spacing resampling so the spline and physics steps are
// uniform along the track.

import type { Vec2 } from "./geo.ts";

/** Euclidean distance between two world points. */
export function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

/** Drop consecutive duplicate points closer than `epsilon` meters. */
export function dedupe(points: Vec2[], epsilon = 0.01): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || dist2(last, p) > epsilon) out.push(p);
  }
  return out;
}

/** Cumulative arc length at each vertex (cum[0] === 0). */
export function cumulativeLengths(points: Vec2[]): number[] {
  const cum: number[] = new Array(points.length);
  cum[0] = 0;
  for (let i = 1; i < points.length; i++) {
    cum[i] = cum[i - 1] + dist2(points[i - 1], points[i]);
  }
  return cum;
}

/** Total length of the polyline in meters. */
export function totalLength(points: Vec2[]): number {
  if (points.length < 2) return 0;
  const cum = cumulativeLengths(points);
  return cum[cum.length - 1];
}

/**
 * Resample a polyline to evenly spaced points (`spacing` meters apart) using
 * arc-length interpolation. The first and last original points are preserved.
 */
export function resample(points: Vec2[], spacing: number): Vec2[] {
  if (spacing <= 0) throw new Error("spacing must be positive");
  if (points.length < 2) return points.slice();

  const cum = cumulativeLengths(points);
  const total = cum[cum.length - 1];
  const out: Vec2[] = [];
  let seg = 0;
  for (let d = 0; d <= total; d += spacing) {
    while (seg < points.length - 2 && cum[seg + 1] < d) seg++;
    const segLen = cum[seg + 1] - cum[seg];
    const t = segLen > 0 ? (d - cum[seg]) / segLen : 0;
    out.push({
      x: points[seg].x + (points[seg + 1].x - points[seg].x) * t,
      z: points[seg].z + (points[seg + 1].z - points[seg].z) * t,
    });
  }

  const last = points[points.length - 1];
  if (out.length === 0 || dist2(out[out.length - 1], last) > 1e-6) out.push(last);
  return out;
}

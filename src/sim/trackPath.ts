import type { TrackPoint } from "../core/types.ts";
import { clamp } from "../core/math.ts";

export interface Vec2 {
  x: number;
  z: number;
}

/**
 * A drivable path along a track. Wraps the resampled points (each carrying its
 * cumulative `dist`) and answers "where am I / which way am I facing" for a
 * given arc-length position `s` in meters.
 *
 * Sampling runs through a uniform Catmull-Rom spline over the points instead
 * of the raw polyline (Factorio-style: vehicles must never ride a tangent
 * kink). The spline passes through every point, degrades to exact linear
 * interpolation on straight runs, and gives a continuously turning tangent
 * through corners. `s` remains the polyline's chord parameterization — the
 * spline's true arc length differs by a negligible amount at GTFS scales.
 */
export class TrackPath {
  readonly length: number;
  private readonly points: TrackPoint[];

  constructor(points: TrackPoint[]) {
    if (points.length < 2) throw new Error("TrackPath needs at least 2 points");
    this.points = points;
    this.length = points[points.length - 1].dist;
  }

  /** Index of the segment [i, i+1] containing arc-length `s`. */
  private segmentIndex(s: number): number {
    const pts = this.points;
    const target = clamp(s, 0, this.length);
    let lo = 0;
    let hi = pts.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (pts[mid].dist <= target) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /**
   * Catmull-Rom control points for segment `i`. Endpoints get reflected
   * phantom neighbors, which keeps straight end segments exactly linear.
   */
  private controls(i: number): [Vec2, TrackPoint, TrackPoint, Vec2] {
    const pts = this.points;
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p0: Vec2 =
      i > 0 ? pts[i - 1] : { x: 2 * p1.x - p2.x, z: 2 * p1.z - p2.z };
    const p3: Vec2 =
      i + 2 < pts.length
        ? pts[i + 2]
        : { x: 2 * p2.x - p1.x, z: 2 * p2.z - p1.z };
    return [p0, p1, p2, p3];
  }

  /** Local parameter t within segment `i` for arc-length `s`. */
  private localT(s: number, i: number): number {
    const a = this.points[i];
    const b = this.points[i + 1];
    const segLen = b.dist - a.dist;
    return segLen > 0 ? (clamp(s, 0, this.length) - a.dist) / segLen : 0;
  }

  /** World position at arc-length `s`. */
  positionAt(s: number): Vec2 {
    const i = this.segmentIndex(s);
    const [p0, p1, p2, p3] = this.controls(i);
    const t = this.localT(s, i);
    const t2 = t * t;
    const t3 = t2 * t;
    return {
      x:
        0.5 *
        (2 * p1.x +
          (p2.x - p0.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (3 * p1.x - p0.x - 3 * p2.x + p3.x) * t3),
      z:
        0.5 *
        (2 * p1.z +
          (p2.z - p0.z) * t +
          (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
          (3 * p1.z - p0.z - 3 * p2.z + p3.z) * t3),
    };
  }

  /** Unit tangent (direction of travel) at arc-length `s`. */
  tangentAt(s: number): Vec2 {
    const i = this.segmentIndex(s);
    const [p0, p1, p2, p3] = this.controls(i);
    const t = this.localT(s, i);
    const t2 = t * t;
    const dx =
      0.5 *
      (p2.x -
        p0.x +
        2 * (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t +
        3 * (3 * p1.x - p0.x - 3 * p2.x + p3.x) * t2);
    const dz =
      0.5 *
      (p2.z -
        p0.z +
        2 * (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t +
        3 * (3 * p1.z - p0.z - 3 * p2.z + p3.z) * t2);
    const len = Math.hypot(dx, dz) || 1;
    return { x: dx / len, z: dz / len };
  }

  /** Yaw angle (radians) facing along the tangent, for Three.js rotation.y. */
  headingAt(s: number): number {
    const t = this.tangentAt(s);
    return Math.atan2(t.x, t.z);
  }

  /**
   * Densified points along the smooth curve (spacing in meters), for building
   * visual geometry that must agree with where vehicles actually ride.
   */
  samplePoints(spacing: number): TrackPoint[] {
    const out: TrackPoint[] = [];
    for (let s = 0; s < this.length; s += spacing) {
      const p = this.positionAt(s);
      out.push({ x: p.x, z: p.z, dist: s });
    }
    const end = this.positionAt(this.length);
    out.push({ x: end.x, z: end.z, dist: this.length });
    return out;
  }
}

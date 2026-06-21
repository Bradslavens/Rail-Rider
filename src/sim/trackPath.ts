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

  /** World position at arc-length `s`. */
  positionAt(s: number): Vec2 {
    const target = clamp(s, 0, this.length);
    const i = this.segmentIndex(target);
    const a = this.points[i];
    const b = this.points[i + 1];
    const segLen = b.dist - a.dist;
    const t = segLen > 0 ? (target - a.dist) / segLen : 0;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
  }

  /** Unit tangent (direction of travel) at arc-length `s`. */
  tangentAt(s: number): Vec2 {
    const i = this.segmentIndex(s);
    const a = this.points[i];
    const b = this.points[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: dx / len, z: dz / len };
  }

  /** Yaw angle (radians) facing along the tangent, for Three.js rotation.y. */
  headingAt(s: number): number {
    const t = this.tangentAt(s);
    return Math.atan2(t.x, t.z);
  }
}

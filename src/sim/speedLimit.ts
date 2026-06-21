import type { TrackPoint } from "../core/types.ts";

// Curve-based speed restrictions. The resampled track points trace the real
// alignment, so the local curvature tells us how fast a curve can be taken
// before lateral acceleration gets uncomfortable: v = sqrt(a_lat / kappa).

export interface SpeedLimitParams {
  /** Comfortable lateral acceleration through curves (m/s²). */
  lateralAccel: number;
  /** Absolute ceiling — the line's top speed (m/s). */
  maxSpeed: number;
  /** How far ahead to look so we slow *before* a curve, not in it (m). */
  lookaheadM: number;
}

export const DEFAULT_SPEED_LIMIT: SpeedLimitParams = {
  lateralAccel: 1.2,
  maxSpeed: 24.4,
  lookaheadM: 160,
};

/** Discrete (Menger) curvature at point b given its neighbours a and c. */
function curvature(a: TrackPoint, b: TrackPoint, c: TrackPoint): number {
  const cross = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const dAB = Math.hypot(b.x - a.x, b.z - a.z);
  const dBC = Math.hypot(c.x - b.x, c.z - b.z);
  const dCA = Math.hypot(a.x - c.x, a.z - c.z);
  const denom = dAB * dBC * dCA;
  if (denom === 0) return 0;
  return (2 * Math.abs(cross)) / denom;
}

/**
 * Precomputes a speed limit at every track point, then answers "what's the
 * lowest limit I need to respect from here forward" (over a lookahead window)
 * so the driver can brake into curves rather than barrel through them.
 */
export class SpeedLimitProfile {
  private readonly dists: number[];
  private readonly limits: number[];
  private readonly maxSpeed: number;
  private readonly lookaheadM: number;

  constructor(points: TrackPoint[], params: SpeedLimitParams = DEFAULT_SPEED_LIMIT) {
    this.maxSpeed = params.maxSpeed;
    this.lookaheadM = params.lookaheadM;
    this.dists = points.map((p) => p.dist);
    this.limits = points.map((p, i) => {
      if (i === 0 || i === points.length - 1) return params.maxSpeed;
      const k = curvature(points[i - 1], p, points[i + 1]);
      if (k <= 0) return params.maxSpeed;
      const v = Math.sqrt(params.lateralAccel / k);
      return Math.min(params.maxSpeed, v);
    });
  }

  /** First index whose dist >= s (binary search lower bound). */
  private lowerBound(s: number): number {
    let lo = 0;
    let hi = this.dists.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.dists[mid] < s) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Lowest speed limit (m/s) over [s, s + lookahead]. */
  limitAt(s: number): number {
    const end = s + this.lookaheadM;
    let i = this.lowerBound(s);
    if (i > 0) i--; // include the segment we're currently on
    let min = this.maxSpeed;
    for (; i < this.dists.length && this.dists[i] <= end; i++) {
      if (this.limits[i] < min) min = this.limits[i];
    }
    return min;
  }
}

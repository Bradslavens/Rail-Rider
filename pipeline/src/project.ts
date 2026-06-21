// Project an arbitrary world point (e.g. a station's real coordinates) onto the
// nearest point of a track polyline, returning where along the track it lands.
// Used to attach stations to a line without trusting GTFS distance units.

import type { Vec2 } from "./geo.ts";
import { cumulativeLengths } from "./polyline.ts";

export interface Projection {
  /** Distance along the polyline (meters from its first point). */
  distAlong: number;
  /** The closest point on the polyline. */
  point: Vec2;
  /** Perpendicular distance from `p` to the track (meters). */
  offset: number;
  /** Index of the segment the projection landed on. */
  segmentIndex: number;
}

/** Closest point of segment [a,b] to p, as a clamped parameter t in [0,1]. */
function closestT(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lenSq = dx * dx + dz * dz;
  if (lenSq === 0) return 0;
  const t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / lenSq;
  return Math.max(0, Math.min(1, t));
}

/** Project `p` onto `polyline`, choosing the globally nearest segment. */
export function projectToPolyline(p: Vec2, polyline: Vec2[]): Projection {
  if (polyline.length === 0) throw new Error("cannot project onto empty polyline");
  if (polyline.length === 1) {
    const only = polyline[0];
    return {
      distAlong: 0,
      point: only,
      offset: Math.hypot(p.x - only.x, p.z - only.z),
      segmentIndex: 0,
    };
  }

  const cum = cumulativeLengths(polyline);
  let best: Projection | null = null;
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const t = closestT(p, a, b);
    const cx = a.x + (b.x - a.x) * t;
    const cz = a.z + (b.z - a.z) * t;
    const offset = Math.hypot(p.x - cx, p.z - cz);
    if (!best || offset < best.offset) {
      const segLen = cum[i + 1] - cum[i];
      best = {
        distAlong: cum[i] + segLen * t,
        point: { x: cx, z: cz },
        offset,
        segmentIndex: i,
      };
    }
  }
  return best as Projection;
}

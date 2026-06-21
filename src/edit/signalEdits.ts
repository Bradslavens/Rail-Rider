import type { Signal, SignalSide, TrackPoint } from "../core/types.ts";

// Pure helpers behind the signal editor: snap a dragged world point onto the
// nearest place on a track (so a moved signal stays anchored to shapeId+distM),
// plus simple immutable CRUD over the signal list.

export interface NearestResult {
  /** Arc-length along the shape (m) of the closest centreline point. */
  distM: number;
  /** Which side of the direction of travel the input point fell on. */
  side: SignalSide;
  /** The closest point on the centreline. */
  x: number;
  z: number;
}

/** Closest point of segment [a,b] to (px,pz) as a clamped t in [0,1]. */
function closestT(px: number, pz: number, a: TrackPoint, b: TrackPoint): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lenSq = dx * dx + dz * dz;
  if (lenSq === 0) return 0;
  const t = ((px - a.x) * dx + (pz - a.z) * dz) / lenSq;
  return Math.max(0, Math.min(1, t));
}

/**
 * Project a world point onto a shape's polyline: returns the arc-length there
 * and which side (L/R relative to travel) the point lies on. The side matches
 * placeSignals' convention (R is the (tan.z, -tan.x) direction).
 */
export function nearestOnPath(points: TrackPoint[], px: number, pz: number): NearestResult {
  let best: NearestResult | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const t = closestT(px, pz, a, b);
    const cx = a.x + (b.x - a.x) * t;
    const cz = a.z + (b.z - a.z) * t;
    const off = Math.hypot(px - cx, pz - cz);
    if (off < bestDist) {
      bestDist = off;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      const tx = dx / len;
      const tz = dz / len;
      // Right side is the (tz, -tx) direction from the centreline.
      const side: SignalSide = (px - cx) * tz + (pz - cz) * -tx >= 0 ? "R" : "L";
      best = { distM: a.dist + (b.dist - a.dist) * t, side, x: cx, z: cz };
    }
  }
  if (!best) throw new Error("nearestOnPath needs at least 2 points");
  return best;
}

/** A short unique id for a new signal on a shape (e.g. "S2_510_0_352-sig-3"). */
export function nextSignalId(list: Signal[], shapeId: string): string {
  let n = list.length + 1;
  const ids = new Set(list.map((s) => s.id));
  let id = `${shapeId}-sig-${n}`;
  while (ids.has(id)) id = `${shapeId}-sig-${++n}`;
  return id;
}

export function addSignal(list: Signal[], sig: Signal): Signal[] {
  return [...list, sig];
}

export function updateSignal(list: Signal[], id: string, patch: Partial<Signal>): Signal[] {
  return list.map((s) => (s.id === id ? { ...s, ...patch, id: s.id } : s));
}

export function deleteSignal(list: Signal[], id: string): Signal[] {
  return list.filter((s) => s.id !== id);
}

import type { TrackPoint } from "../core/types.ts";

/**
 * Smooth a resampled track polyline to kill the high-frequency lateral jitter
 * baked into GTFS shape points. The train rides a Catmull-Rom spline through
 * these points (see {@link TrackPath}), which faithfully reproduces every kink;
 * filtering the vertices first is what turns a wobbly corner into a clean arc —
 * the same "trains follow a smooth path" feel as a Factorio circular curve.
 *
 * A binomial [1,4,6,4,1]/16 kernel is applied `iterations` times. Endpoints are
 * pinned (so the line keeps its exact extent and station 0), and points near
 * the ends fall back to a narrower symmetric window so nothing is dragged
 * inward. Cumulative `dist` is recomputed from the moved positions so the
 * arc-length parameterization stays consistent; at light settings total length
 * shifts by well under the tolerance callers have signed off on.
 */
export function smoothTrackPoints(
  points: TrackPoint[],
  iterations = 4,
): TrackPoint[] {
  const n = points.length;
  if (n < 5) return points.map((p) => ({ ...p }));

  let xs = points.map((p) => p.x);
  let zs = points.map((p) => p.z);

  for (let it = 0; it < iterations; it++) {
    const nx = xs.slice();
    const nz = zs.slice();
    for (let i = 1; i < n - 1; i++) {
      // Widest symmetric window that fits without running off either end,
      // capped at 2 neighbors each side (the binomial kernel's half-width).
      const w = Math.min(2, i, n - 1 - i);
      if (w === 1) {
        nx[i] = (xs[i - 1] + 2 * xs[i] + xs[i + 1]) / 4;
        nz[i] = (zs[i - 1] + 2 * zs[i] + zs[i + 1]) / 4;
      } else {
        nx[i] =
          (xs[i - 2] + 4 * xs[i - 1] + 6 * xs[i] + 4 * xs[i + 1] + xs[i + 2]) /
          16;
        nz[i] =
          (zs[i - 2] + 4 * zs[i - 1] + 6 * zs[i] + 4 * zs[i + 1] + zs[i + 2]) /
          16;
      }
    }
    xs = nx;
    zs = nz;
  }

  const out: TrackPoint[] = [{ x: xs[0], z: zs[0], dist: 0 }];
  let d = 0;
  for (let i = 1; i < n; i++) {
    d += Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
    out.push({ x: xs[i], z: zs[i], dist: d });
  }
  return out;
}

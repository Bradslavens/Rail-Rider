import type { Signal, PlacedSignal } from "../core/types.ts";
import type { TrackPath } from "./trackPath.ts";

// Resolve wayside signals (anchored to a shape at an arc-length `distM`) to
// world positions. Each signal sits a fixed distance to one side of the track
// centreline and faces the train approaching it (i.e. against travel).

export const SIGNAL_OFFSET_M = 7;

/**
 * Place each signal in the world using its shape's path. Signals whose shapeId
 * has no path are skipped. Pure: returns a new array.
 */
export function placeSignals(
  signals: Signal[],
  pathsByShape: Map<string, TrackPath>,
  offsetM: number = SIGNAL_OFFSET_M,
): PlacedSignal[] {
  const placed: PlacedSignal[] = [];
  for (const sig of signals) {
    const path = pathsByShape.get(sig.shapeId);
    if (!path) continue;

    const pos = path.positionAt(sig.distM);
    const tan = path.tangentAt(sig.distM);
    // Right-hand perpendicular to the direction of travel (sign flips for L).
    const sign = sig.side === "R" ? 1 : -1;
    const px = tan.z * sign;
    const pz = -tan.x * sign;

    placed.push({
      ...sig,
      x: pos.x + px * offsetM,
      z: pos.z + pz * offsetM,
      headingRad: Math.atan2(-tan.x, -tan.z),
    });
  }
  return placed;
}

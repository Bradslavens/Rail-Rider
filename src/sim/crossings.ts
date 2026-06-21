// Level-crossing gate logic. A crossing is anchored to a track at an arc-length
// `distM`; the gates close while a train is within an approach window of it.

export interface CrossingParams {
  /** Gates close when the train is within this distance of the crossing (m). */
  approachM: number;
  /** A crossing counts as "on" a track if its offset is under this (m). */
  onlineOffsetM: number;
}

export const DEFAULT_CROSSING: CrossingParams = {
  approachM: 140,
  onlineOffsetM: 22,
};

/**
 * Whether the gates should be down: true when the train (at arc-length
 * `trainS`) is within `approachM` of a crossing at `crossingDistM`. Symmetric,
 * so it works whichever direction the train is travelling.
 */
export function gateClosed(trainS: number, crossingDistM: number, approachM: number): boolean {
  return Math.abs(trainS - crossingDistM) <= approachM;
}

import type { TrackStation } from "../core/types.ts";

// Station service state machine: detect arrival when the trolley is stopped
// within a platform zone, hold the doors open for a dwell, then depart.

export type StopPhase = "CRUISING" | "DWELLING" | "DEPARTING";

export interface StopParams {
  /** Half-length of the platform zone around a station (m). */
  platformHalfWidth: number;
  /** At or below this speed counts as "stopped" (m/s). */
  arriveSpeed: number;
  /** How long the doors stay open (s). */
  dwellSeconds: number;
}

export interface StopState {
  phase: StopPhase;
  /** Index into the track's stations for the current/last serviced stop. */
  stationIndex: number;
  /** Seconds of dwell remaining while DWELLING. */
  dwellRemaining: number;
  doorsOpen: boolean;
}

export const DEFAULT_STOP_PARAMS: StopParams = {
  platformHalfWidth: 25,
  arriveSpeed: 0.3,
  dwellSeconds: 8,
};

export const INITIAL_STOP: StopState = {
  phase: "CRUISING",
  stationIndex: -1,
  dwellRemaining: 0,
  doorsOpen: false,
};

/** Nearest station within the platform zone of arc-length `s`, or -1. */
function stationAt(s: number, stations: TrackStation[], halfWidth: number): number {
  let best = -1;
  let bestDist = halfWidth;
  for (let i = 0; i < stations.length; i++) {
    const d = Math.abs(stations[i].distAlong - s);
    if (d <= bestDist) {
      best = i;
      bestDist = d;
    }
  }
  return best;
}

/** Advance the stop controller one timestep. Pure: returns a new state. */
export function updateStop(
  state: StopState,
  pos: { s: number; v: number },
  stations: TrackStation[],
  params: StopParams,
  dt: number,
): StopState {
  const near = stationAt(pos.s, stations, params.platformHalfWidth);

  switch (state.phase) {
    case "DWELLING": {
      const remaining = state.dwellRemaining - dt;
      if (remaining <= 0) {
        return { phase: "DEPARTING", stationIndex: state.stationIndex, dwellRemaining: 0, doorsOpen: false };
      }
      return { ...state, dwellRemaining: remaining };
    }

    case "DEPARTING": {
      // Hold this phase (doors closed) until we clear the platform zone, so we
      // don't re-open doors at the stop we just left.
      if (near !== state.stationIndex) {
        return { phase: "CRUISING", stationIndex: -1, dwellRemaining: 0, doorsOpen: false };
      }
      return state;
    }

    case "CRUISING":
    default: {
      if (near !== -1 && Math.abs(pos.v) <= params.arriveSpeed) {
        return { phase: "DWELLING", stationIndex: near, dwellRemaining: params.dwellSeconds, doorsOpen: true };
      }
      return state;
    }
  }
}

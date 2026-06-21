import { describe, it, expect } from "vitest";
import { updateStop, INITIAL_STOP, DEFAULT_STOP_PARAMS, type StopState } from "../src/sim/stops.ts";
import type { TrackStation } from "../src/core/types.ts";

const STATIONS: TrackStation[] = [
  { stationId: "a", name: "Alpha", distAlong: 0 },
  { stationId: "b", name: "Bravo", distAlong: 500 },
  { stationId: "c", name: "Charlie", distAlong: 1000 },
];

const P = DEFAULT_STOP_PARAMS;
const step = (state: StopState, s: number, v: number, dt = 0.1) =>
  updateStop(state, { s, v }, STATIONS, P, dt);

describe("updateStop", () => {
  it("stays cruising between stations", () => {
    const s = step(INITIAL_STOP, 250, 20);
    expect(s.phase).toBe("CRUISING");
    expect(s.doorsOpen).toBe(false);
  });

  it("does not open doors passing through a platform at speed", () => {
    const s = step(INITIAL_STOP, 500, 15);
    expect(s.phase).toBe("CRUISING");
    expect(s.doorsOpen).toBe(false);
  });

  it("opens doors when stopped at a platform", () => {
    const s = step(INITIAL_STOP, 502, 0.1);
    expect(s.phase).toBe("DWELLING");
    expect(s.doorsOpen).toBe(true);
    expect(s.stationIndex).toBe(1);
    expect(s.dwellRemaining).toBe(P.dwellSeconds);
  });

  it("counts down the dwell then departs with doors closed", () => {
    let s = step(INITIAL_STOP, 500, 0); // DWELLING
    s = updateStop(s, { s: 500, v: 0 }, STATIONS, P, 3);
    expect(s.phase).toBe("DWELLING");
    expect(s.dwellRemaining).toBeCloseTo(P.dwellSeconds - 3, 5);
    expect(s.doorsOpen).toBe(true);
    // Burn the rest of the dwell.
    s = updateStop(s, { s: 500, v: 0 }, STATIONS, P, P.dwellSeconds);
    expect(s.phase).toBe("DEPARTING");
    expect(s.doorsOpen).toBe(false);
  });

  it("does not re-open doors at the stop it just left, then resumes cruising", () => {
    let s: StopState = { phase: "DEPARTING", stationIndex: 1, dwellRemaining: 0, doorsOpen: false };
    // Still in Bravo's platform zone, even momentarily stopped: stay DEPARTING.
    s = step(s, 510, 0);
    expect(s.phase).toBe("DEPARTING");
    expect(s.doorsOpen).toBe(false);
    // Clear the zone: back to cruising, ready for the next station.
    s = step(s, 540, 5);
    expect(s.phase).toBe("CRUISING");
    expect(s.stationIndex).toBe(-1);
  });

  it("services each station in sequence", () => {
    let s = step(INITIAL_STOP, 500, 0); // dwell at Bravo
    s = updateStop(s, { s: 500, v: 0 }, STATIONS, P, P.dwellSeconds + 1); // depart
    s = step(s, 600, 10); // clear zone -> cruising
    expect(s.phase).toBe("CRUISING");
    s = step(s, 1000, 0); // arrive Charlie
    expect(s.phase).toBe("DWELLING");
    expect(s.stationIndex).toBe(2);
  });
});

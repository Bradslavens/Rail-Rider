import { clamp } from "../core/math.ts";

// A simple longitudinal model: the trolley moves along a track's arc-length `s`
// with velocity `v` (m/s; negative = reversing). Tuned to feel like light rail.

export interface TrolleyParams {
  /** Top speed in m/s (~24.4 m/s ≈ 88 km/h for the SD Trolley). */
  maxSpeed: number;
  /** Tractive acceleration at full throttle (m/s²). */
  accel: number;
  /** Service braking deceleration at full brake (m/s²). */
  brakeDecel: number;
  /** Linear rolling/air drag as a fraction of speed lost per second. */
  dragCoeff: number;
}

export interface ControlInput {
  throttle: number; // 0..1
  brake: number; // 0..1
  reverse: boolean;
}

export interface TrolleyState {
  s: number; // arc-length position (m)
  v: number; // velocity (m/s), signed
}

export const DEFAULT_PARAMS: TrolleyParams = {
  maxSpeed: 24.4,
  accel: 1.1,
  brakeDecel: 1.6,
  dragCoeff: 0.02,
};

/** Advance the trolley one timestep. Pure: returns a new state. */
export function stepTrolley(
  state: TrolleyState,
  params: TrolleyParams,
  input: ControlInput,
  dt: number,
  trackLength: number,
): TrolleyState {
  const dir = input.reverse ? -1 : 1;
  let v = state.v;

  // Tractive effort (in the selected direction of travel).
  v += input.throttle * params.accel * dir * dt;

  // Service braking always opposes current motion and never reverses through 0.
  if (input.brake > 0 && v !== 0) {
    const dec = input.brake * params.brakeDecel * dt;
    v = Math.abs(v) <= dec ? 0 : v - Math.sign(v) * dec;
  }

  // Drag.
  v -= v * params.dragCoeff * dt;

  // Speed limit.
  v = clamp(v, -params.maxSpeed, params.maxSpeed);

  // Integrate position; stop hard at either end of the line.
  let s = state.s + v * dt;
  if (s <= 0) {
    s = 0;
    v = 0;
  } else if (s >= trackLength) {
    s = trackLength;
    v = 0;
  }

  return { s, v };
}

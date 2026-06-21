// Fixed-timestep accumulator for the sim. Real frame time is scaled by a speed
// multiplier, then consumed in small fixed slices so physics, station-arrival
// detection, and signal logic stay accurate no matter how fast we run.

export const FIXED_DT = 0.02; // 50 Hz physics
export const MAX_SUBSTEPS = 240; // ceiling so a long stall can't spiral

/** Speed multipliers the UI cycles through. */
export const TIME_SCALES = [1, 2, 5, 10, 20];

export interface SubstepPlan {
  /** Number of fixed FIXED_DT steps to run this frame. */
  steps: number;
  /** Time left over (carried into the next frame's accumulator). */
  remainder: number;
}

/**
 * Given the carried `accumulator` plus this frame's scaled elapsed time,
 * return how many fixed steps to run and the leftover to carry forward.
 * Capped at `maxSteps`; excess time is dropped so we never run unbounded work.
 */
export function planSubsteps(
  accumulator: number,
  scaledElapsed: number,
  fixedDt: number = FIXED_DT,
  maxSteps: number = MAX_SUBSTEPS,
): SubstepPlan {
  let pool = accumulator + scaledElapsed;
  let steps = Math.floor(pool / fixedDt);
  if (steps > maxSteps) {
    steps = maxSteps;
    pool = steps * fixedDt; // drop the backlog we won't simulate
  }
  return { steps, remainder: pool - steps * fixedDt };
}

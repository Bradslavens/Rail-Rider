// Small pure math helpers shared by the sim and pipeline.
// Kept dependency-free so they're trivially unit-testable.

/** Clamp `value` into the inclusive range [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Linear interpolation from `a` to `b` by `t` (t is clamped to [0, 1]). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

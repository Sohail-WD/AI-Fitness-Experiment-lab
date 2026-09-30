/**
 * Deterministic metrics (spec §14, §19.1). These are the only source of
 * numbers shown to users or passed to the AI layer.
 */

/**
 * Adherence = completed planned workouts / total planned workouts (spec §14).
 * Returns null when nothing was planned: adherence is undefined, not 0% or 100%.
 */
export function calculateAdherence(plannedWorkouts: number, completedWorkouts: number): number | null {
  if (!Number.isInteger(plannedWorkouts) || !Number.isInteger(completedWorkouts)) {
    throw new RangeError('workout counts must be integers');
  }
  if (plannedWorkouts < 0 || completedWorkouts < 0) throw new RangeError('workout counts must be non-negative');
  if (completedWorkouts > plannedWorkouts) {
    throw new RangeError('completed planned workouts cannot exceed planned workouts');
  }
  if (plannedWorkouts === 0) return null;
  return completedWorkouts / plannedWorkouts;
}

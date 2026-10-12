import type { ExerciseSetResult } from '../schemas/metrics.ts';
import type { WorkoutItem } from '../schemas/workout.ts';

/**
 * Genuine completion (M11). A recorded set only counts toward completion,
 * adherence and experiments when real work is evidenced:
 * - rep-based set: at least one VALID rep (camera-validated or entered by the user);
 * - timed set: the interval was finished (the runner's timer, or the user confirming "Done").
 * Pressing "Complete set" with zero valid reps is recorded, but not counted.
 */

type PlannedItem = Pick<WorkoutItem, 'exerciseId' | 'sets' | 'target'>;

export function isGenuineSet(result: Pick<ExerciseSetResult, 'validReps'>, target: WorkoutItem['target']): boolean {
  return target.type === 'duration' || result.validReps >= 1;
}

export const plannedSetCount = (items: readonly Pick<WorkoutItem, 'sets'>[]) => items.reduce((n, i) => n + i.sets, 0);

/** Genuine sets, capped per exercise at the sets planned for it. Sets for exercises not in the plan are ignored. */
export function countGenuineSets(sets: readonly ExerciseSetResult[], items: readonly PlannedItem[]): number {
  const byExercise = new Map(items.map((i) => [i.exerciseId, i]));
  const counted = new Map<string, number>();
  for (const result of sets) {
    const item = byExercise.get(result.exerciseId);
    if (item && isGenuineSet(result, item.target)) counted.set(item.exerciseId, (counted.get(item.exerciseId) ?? 0) + 1);
  }
  let total = 0;
  for (const [id, n] of counted) total += Math.min(n, byExercise.get(id)!.sets);
  return total;
}

/** Genuine sets / planned sets (0–1). */
export function genuineCompletionRatio(sets: readonly ExerciseSetResult[], items: readonly PlannedItem[]): number {
  const planned = plannedSetCount(items);
  return planned > 0 ? Math.min(1, countGenuineSets(sets, items) / planned) : 0;
}

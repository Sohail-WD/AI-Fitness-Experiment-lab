import type { ExerciseDefinition } from '../schemas/exercise.ts';
import { catalogExercises } from './catalog.ts';
import { squatExercise } from './squat.ts';

/**
 * The exercise library (spec §6.1, §19.2). New exercises are added as data.
 * Only the squat has CV support so far.
 */
export const exerciseLibrary: readonly ExerciseDefinition[] = [squatExercise, ...catalogExercises];

export function findExercise(id: string): ExerciseDefinition | undefined {
  return exerciseLibrary.find((e) => e.id === id);
}

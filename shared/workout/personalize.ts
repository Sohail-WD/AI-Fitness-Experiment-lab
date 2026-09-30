import type { FitnessLevel, Goal, Location, Space, TrainingContext } from '../schemas/common.ts';
import type { ExerciseDefinition } from '../schemas/exercise.ts';
import type { UserConstraints, UserProfile } from '../schemas/profile.ts';
import type { TrainingParameters, WorkoutRequirements } from '../schemas/workout.ts';

/**
 * Personalization engine (spec §5): profile + constraints + exercise library →
 * WorkoutRequirements. Deterministic; no LLM. Hard filters decide which
 * exercises are allowed; the generator decides which of those to use.
 */

type Params = Omit<TrainingParameters, 'holdSeconds'>;

/** Baseline prescription per goal (general training guidance, not medical advice). */
const GOAL_PARAMS: Record<Goal, Params> = {
  strength: { sets: 4, repsMin: 5, repsMax: 8, restSeconds: 120 },
  muscle_building: { sets: 3, repsMin: 8, repsMax: 12, restSeconds: 75 },
  endurance: { sets: 3, repsMin: 15, repsMax: 20, restSeconds: 30 },
  weight_management: { sets: 3, repsMin: 12, repsMax: 15, restSeconds: 40 },
  general_fitness: { sets: 3, repsMin: 10, repsMax: 12, restSeconds: 60 },
  explosive_strength: { sets: 4, repsMin: 4, repsMax: 6, restSeconds: 120 },
  mobility: { sets: 2, repsMin: 8, repsMax: 10, restSeconds: 45 },
  sport_performance: { sets: 3, repsMin: 6, repsMax: 10, restSeconds: 90 },
  consistency: { sets: 2, repsMin: 10, repsMax: 12, restSeconds: 60 },
};

const HOLD_SECONDS: Record<FitnessLevel, number> = { beginner: 20, intermediate: 30, advanced: 40 };

/** Typical space when the user has not specified one. */
const DEFAULT_SPACE: Record<Location, Space> = { home: 'medium', gym: 'large', outdoors: 'large', other: 'medium' };
const SPACE_RANK: Record<Space, number> = { small: 0, medium: 1, large: 2 };
const LEVEL_RANK: Record<FitnessLevel, number> = { beginner: 0, intermediate: 1, advanced: 2 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function trainingParametersFor(
  goal: Goal,
  level: FitnessLevel,
  context: TrainingContext,
  workoutsPerWeek: number,
): TrainingParameters {
  const p = { ...GOAL_PARAMS[goal] };
  let holdSeconds = HOLD_SECONDS[level];

  if (level === 'beginner') {
    p.sets -= 1;
    p.restSeconds += 15;
  } else if (level === 'advanced' && (goal === 'strength' || goal === 'muscle_building')) {
    p.sets += 1;
  }
  if (context === 'sedentary') {
    p.sets -= 1;
    p.restSeconds += 15;
    holdSeconds -= 5;
  } else if (context === 'athletic') {
    holdSeconds += 10;
  }
  if (goal === 'endurance' || goal === 'weight_management') holdSeconds += 10;
  // Training most days: slightly lower per-session volume.
  if (workoutsPerWeek >= 5) p.sets -= 1;

  return { ...p, sets: clamp(p.sets, 2, 6), holdSeconds: clamp(holdSeconds, 15, 60) };
}

export function hasRequiredEquipment(exercise: ExerciseDefinition, available: readonly string[]): boolean {
  if (available.includes('full_gym')) return true;
  return exercise.requiredEquipment.every((e) => available.includes(e));
}

export function personalize(
  profile: UserProfile,
  constraints: UserConstraints,
  library: readonly ExerciseDefinition[],
): WorkoutRequirements {
  const goal = profile.goals[0];
  const space = profile.environment.space ?? DEFAULT_SPACE[profile.environment.location];
  const restrictions = constraints.restrictionTags;
  // Sedentary users get nothing rated advanced, whatever level they selected.
  const maxDifficulty = profile.trainingContext === 'sedentary' ? Math.min(LEVEL_RANK[profile.fitnessLevel], 1) : 2;

  const eligibleExerciseIds: string[] = [];
  const exclusions: WorkoutRequirements['exclusions'] = [];
  for (const exercise of library) {
    const reason = !hasRequiredEquipment(exercise, profile.equipment)
      ? 'equipment'
      : exercise.restrictionTags.some((t) => restrictions.includes(t))
        ? 'restriction'
        : !exercise.applicableLevels.includes(profile.fitnessLevel) || LEVEL_RANK[exercise.difficulty] > maxDifficulty
          ? 'level'
          : SPACE_RANK[exercise.minSpace] > SPACE_RANK[space]
            ? 'space'
            : null;
    if (reason) exclusions.push({ exerciseId: exercise.id, reason });
    else eligibleExerciseIds.push(exercise.id);
  }

  return {
    userId: profile.id,
    fitnessLevel: profile.fitnessLevel,
    goals: profile.goals,
    trainingContext: profile.trainingContext,
    availableEquipment: profile.equipment,
    targetDurationMinutes: profile.availableMinutes,
    workoutsPerWeek: profile.schedule.workoutsPerWeek,
    location: profile.environment.location,
    space,
    restrictions,
    trainingParameters: trainingParametersFor(
      goal,
      profile.fitnessLevel,
      profile.trainingContext,
      profile.schedule.workoutsPerWeek,
    ),
    eligibleExerciseIds,
    exclusions,
  };
}

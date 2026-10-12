import { describe, expect, it } from 'vitest';
import { exerciseLibrary } from '../../shared/exercises/library';
import { countGenuineSets, genuineCompletionRatio, isGenuineSet } from '../../shared/metrics/completion';
import type { ExerciseSetResult } from '../../shared/schemas/metrics';
import type { WorkoutItem } from '../../shared/schemas/workout';
import { profile as baseProfile, constraints as baseConstraints } from '../fixtures/contracts';
import { generateWorkout } from '../../shared/workout/generate';
import { personalize, restrictionConflicts } from '../../shared/workout/personalize';

const set = (exerciseId: string, validReps: number): ExerciseSetResult => ({
  exerciseId,
  detectedReps: validReps,
  validReps,
  invalidReps: 0,
  metrics: { lowestPrimaryAngleDeg: null, averageRepDurationMs: null, usableFrameRatio: null },
  formIssues: [],
  measurementSource: 'cv',
});
const reps: WorkoutItem['target'] = { type: 'reps', reps: 10 };
const timed: WorkoutItem['target'] = { type: 'duration', seconds: 30 };
const items = [
  { exerciseId: 'squat', sets: 2, target: reps },
  { exerciseId: 'plank', sets: 1, target: timed },
];

describe('genuine completion (M11)', () => {
  it('a rep-based set needs at least one valid rep; a timed set counts when finished', () => {
    expect(isGenuineSet(set('squat', 0), reps)).toBe(false);
    expect(isGenuineSet(set('squat', 1), reps)).toBe(true);
    expect(isGenuineSet(set('plank', 0), timed)).toBe(true);
  });

  it('sets with zero valid reps are not counted toward the completion ratio', () => {
    expect(genuineCompletionRatio([set('squat', 0), set('squat', 0), set('plank', 0)], items)).toBeCloseTo(1 / 3);
    expect(genuineCompletionRatio([set('squat', 6), set('squat', 0), set('plank', 0)], items)).toBeCloseTo(2 / 3);
    expect(genuineCompletionRatio([set('squat', 6), set('squat', 7), set('plank', 0)], items)).toBe(1);
  });

  it('cannot exceed the planned sets: extra sets and sets for exercises outside the plan are ignored', () => {
    expect(countGenuineSets([set('squat', 5), set('squat', 5), set('squat', 5), set('burpee', 5)], items)).toBe(2);
    expect(genuineCompletionRatio([], items)).toBe(0);
    expect(genuineCompletionRatio([set('squat', 5)], [])).toBe(0);
  });
});

describe('restrictions (M11)', () => {
  const lunges = exerciseLibrary.filter((e) => e.movementPattern === 'lunge');

  it('every lunge carries the "avoid deep knee flexion" restriction, like the squats', () => {
    expect(lunges.length).toBeGreaterThan(0);
    for (const e of lunges) expect(e.restrictionTags, e.id).toContain('avoid_deep_knee_flexion');
  });

  it('personalization excludes lunges (and squats) for that restriction, so no workout can contain them', () => {
    const profile = { ...baseProfile, equipment: ['dumbbells' as const, 'barbell' as const, 'full_gym' as const] };
    const c = { ...baseConstraints, restrictionTags: ['avoid_deep_knee_flexion' as const] };
    const req = personalize(profile, c, exerciseLibrary);
    for (const e of [...lunges, ...exerciseLibrary.filter((x) => x.movementPattern === 'squat')]) {
      expect(req.eligibleExerciseIds, e.id).not.toContain(e.id);
      expect(req.exclusions).toContainEqual({ exerciseId: e.id, reason: 'restriction' });
    }
    for (const seed of [0, 1, 2, 3]) {
      const plan = generateWorkout(req, exerciseLibrary, seed);
      expect(plan.items.filter((i) => /lunge|squat/.test(i.exerciseId))).toEqual([]);
    }
  });

  it('restrictionConflicts finds exercises of an existing workout that violate the CURRENT restrictions', () => {
    const planItems = [{ exerciseId: 'reverse_lunge' }, { exerciseId: 'plank' }, { exerciseId: 'march_in_place' }];
    expect(restrictionConflicts(planItems, [], exerciseLibrary)).toEqual([]);
    expect(restrictionConflicts(planItems, ['avoid_deep_knee_flexion'], exerciseLibrary).map((e) => e.id)).toEqual(['reverse_lunge']);
    expect(restrictionConflicts(planItems, ['avoid_floor_work'], exerciseLibrary).map((e) => e.id)).toEqual(['plank']);
  });
});

import { describe, expect, it } from 'vitest';
import { exerciseLibrary, findExercise } from '../../shared/exercises/library';
import { profileInputSchema, type ProfileInput, type UserConstraints, type UserProfile } from '../../shared/schemas/profile';
import { hasRequiredEquipment, personalize, trainingParametersFor } from '../../shared/workout/personalize';
import { constraints as baseConstraints, profile as baseProfile } from '../fixtures/contracts';

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return { ...baseProfile, ...overrides };
}
function makeConstraints(restrictionTags: UserConstraints['restrictionTags'] = []): UserConstraints {
  return { ...baseConstraints, restrictionTags };
}
const eligible = (p: UserProfile, c = makeConstraints()) => personalize(p, c, exerciseLibrary).eligibleExerciseIds;

describe('profile input validation', () => {
  const valid: ProfileInput = {
    profile: {
      name: 'Asha',
      fitnessLevel: 'beginner',
      goals: ['general_fitness'],
      trainingContext: 'sedentary',
      equipment: [],
      environment: { location: 'home' },
      availableMinutes: 15,
      schedule: { preferredDays: [], preferredTimes: [], workoutsPerWeek: 3 },
    },
    constraints: { restrictionTags: ['avoid_jumping'], notes: '', source: 'self_reported' },
  };

  it('accepts a complete profile', () => {
    expect(profileInputSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ['empty name', { ...valid, profile: { ...valid.profile, name: '  ' } }],
    ['no goal', { ...valid, profile: { ...valid.profile, goals: [] } }],
    ['unknown goal', { ...valid, profile: { ...valid.profile, goals: ['bulking'] } }],
    ['unknown context', { ...valid, profile: { ...valid.profile, trainingContext: 'athlete' } }],
    ['5 minute session', { ...valid, profile: { ...valid.profile, availableMinutes: 5 } }],
    ['8 days a week', { ...valid, profile: { ...valid.profile, schedule: { ...valid.profile.schedule, workoutsPerWeek: 8 } } }],
    ['free-text restriction tag', { ...valid, constraints: { ...valid.constraints, restrictionTags: ['bad_knee'] } }],
    ['overlong note', { ...valid, constraints: { ...valid.constraints, notes: 'x'.repeat(1001) } }],
  ])('rejects %s', (_label, input) => {
    expect(profileInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('personalize: hard filters', () => {
  it('accounts for every library exercise exactly once (eligible or excluded)', () => {
    const req = personalize(makeProfile(), makeConstraints(), exerciseLibrary);
    const all = [...req.eligibleExerciseIds, ...req.exclusions.map((x) => x.exerciseId)].sort();
    expect(all).toEqual(exerciseLibrary.map((e) => e.id).sort());
  });

  it('bodyweight users only get exercises that need no equipment', () => {
    for (const id of eligible(makeProfile({ equipment: [] }))) {
      expect(findExercise(id)!.requiredEquipment).toEqual([]);
    }
  });

  it('respects specific equipment, and "full gym" unlocks everything', () => {
    const bands = eligible(makeProfile({ equipment: ['resistance_bands'] }));
    expect(bands).toContain('band_row');
    expect(bands).not.toContain('dumbbell_row');
    const gym = eligible(makeProfile({ equipment: ['full_gym'], environment: { location: 'gym' } }));
    expect(gym).toContain('dumbbell_bench_press');
    expect(gym).toContain('barbell_deadlift');
    expect(hasRequiredEquipment(findExercise('dumbbell_bench_press')!, ['dumbbells'])).toBe(false);
  });

  it('excludes exercises conflicting with each restriction tag', () => {
    const cases = [
      ['avoid_deep_knee_flexion', 'squat'],
      ['avoid_overhead_loading', 'dumbbell_shoulder_press'],
      ['avoid_floor_work', 'push_up'],
      ['avoid_jumping', 'jumping_jacks'],
      ['avoid_high_impact', 'high_knees'],
      ['avoid_loaded_spinal_flexion', 'weighted_russian_twist'],
    ] as const;
    for (const [tag, exerciseId] of cases) {
      const req = personalize(makeProfile(), makeConstraints([tag]), exerciseLibrary);
      expect(req.eligibleExerciseIds, tag).not.toContain(exerciseId);
      if (findExercise(exerciseId)!.requiredEquipment.every((e) => baseProfile.equipment.includes(e))) {
        expect(req.exclusions).toContainEqual({ exerciseId, reason: 'restriction' });
      }
      for (const id of req.eligibleExerciseIds) expect(findExercise(id)!.restrictionTags).not.toContain(tag);
    }
  });

  it('filters by level, and sedentary users get nothing rated advanced', () => {
    expect(eligible(makeProfile({ fitnessLevel: 'beginner' }))).not.toContain('goblet_squat');
    const sedentaryAdvanced = eligible(
      makeProfile({ fitnessLevel: 'advanced', trainingContext: 'sedentary', equipment: ['full_gym'], environment: { location: 'gym' } }),
    );
    for (const id of sedentaryAdvanced) expect(findExercise(id)!.difficulty).not.toBe('advanced');
  });

  it('uses the environment: rack-based barbell lifts need gym space', () => {
    const home = personalize(makeProfile({ equipment: ['barbell'], environment: { location: 'home' } }), makeConstraints(), exerciseLibrary);
    expect(home.space).toBe('medium');
    expect(home.exclusions).toContainEqual({ exerciseId: 'barbell_back_squat', reason: 'space' });
    const gym = personalize(makeProfile({ equipment: ['barbell'], environment: { location: 'gym' } }), makeConstraints(), exerciseLibrary);
    expect(gym.eligibleExerciseIds).toContain('barbell_back_squat');
  });

  it('carries time, frequency and restrictions into the requirements', () => {
    const req = personalize(makeProfile({ availableMinutes: 45 }), makeConstraints(['avoid_jumping']), exerciseLibrary);
    expect(req).toMatchObject({ targetDurationMinutes: 45, workoutsPerWeek: 4, restrictions: ['avoid_jumping'] });
  });
});

describe('trainingParametersFor', () => {
  it('differs by goal', () => {
    const strength = trainingParametersFor('strength', 'intermediate', 'regularly_training', 3);
    const endurance = trainingParametersFor('endurance', 'intermediate', 'regularly_training', 3);
    expect(strength.repsMax).toBeLessThan(endurance.repsMin);
    expect(strength.restSeconds).toBeGreaterThan(endurance.restSeconds);
  });

  it('reduces volume for beginners, sedentary users and high frequency, never below 2 sets', () => {
    const base = trainingParametersFor('muscle_building', 'intermediate', 'regularly_training', 3);
    expect(trainingParametersFor('muscle_building', 'beginner', 'regularly_training', 3).sets).toBeLessThan(base.sets);
    expect(trainingParametersFor('muscle_building', 'intermediate', 'regularly_training', 6).sets).toBeLessThan(base.sets);
    expect(trainingParametersFor('endurance', 'beginner', 'sedentary', 6).sets).toBe(2);
  });
});

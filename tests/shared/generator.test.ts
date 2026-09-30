import { describe, expect, it } from 'vitest';
import { exerciseLibrary, findExercise } from '../../shared/exercises/library';
import type { Equipment, FitnessLevel, Goal, Location, RestrictionTag, TrainingContext } from '../../shared/schemas/common';
import type { UserProfile } from '../../shared/schemas/profile';
import { workoutItemSchema } from '../../shared/schemas/workout';
import { estimateWorkoutSeconds, generateWorkout, WorkoutGenerationError } from '../../shared/workout/generate';
import { hasRequiredEquipment, personalize } from '../../shared/workout/personalize';
import { constraints, profile as baseProfile, requirements as baseRequirements } from '../fixtures/contracts';

function plan(profileOverrides: Partial<UserProfile>, restrictions: RestrictionTag[] = [], seed = 0) {
  const profile = { ...baseProfile, ...profileOverrides };
  const req = personalize(profile, { ...constraints, restrictionTags: restrictions }, exerciseLibrary);
  return generateWorkout(req, exerciseLibrary, seed);
}
const ids = (p: ReturnType<typeof plan>) => p.items.map((i) => i.exerciseId);

describe('generateWorkout: invariants across many profiles', () => {
  const levels: FitnessLevel[] = ['beginner', 'intermediate', 'advanced'];
  const goals: Goal[] = ['general_fitness', 'strength', 'muscle_building', 'endurance', 'weight_management'];
  const durations = [15, 30, 45, 60];
  const equipmentSets: Equipment[][] = [[], ['dumbbells'], ['resistance_bands'], ['barbell'], ['full_gym']];
  const contexts: TrainingContext[] = ['sedentary', 'athletic'];
  const locations: Location[] = ['home', 'gym'];
  const restrictionSets: RestrictionTag[][] = [
    [],
    ['avoid_floor_work', 'avoid_deep_knee_flexion'],
    [
      'avoid_high_impact',
      'avoid_jumping',
      'avoid_overhead_loading',
      'avoid_floor_work',
      'avoid_deep_knee_flexion',
      'avoid_loaded_spinal_flexion',
    ],
  ];

  it('always fits the time budget and never uses excluded exercises', () => {
    let count = 0;
    for (const fitnessLevel of levels)
      for (const goal of goals)
        for (const availableMinutes of durations)
          for (const equipment of equipmentSets)
            for (const trainingContext of contexts)
              for (const location of locations)
                for (const restrictions of restrictionSets)
                  for (const seed of [0, 7]) {
                    const label = JSON.stringify({ fitnessLevel, goal, availableMinutes, equipment, trainingContext, location, restrictions, seed });
                    const p = plan(
                      { fitnessLevel, goals: [goal], availableMinutes, equipment, trainingContext, environment: { location } },
                      restrictions,
                      seed,
                    );
                    count++;

                    // Time budget
                    expect(estimateWorkoutSeconds(p.items, exerciseLibrary), label).toBeLessThanOrEqual(availableMinutes * 60);
                    expect(p.estimatedMinutes, label).toBeLessThanOrEqual(availableMinutes);

                    // Structure
                    expect(p.items.some((i) => i.section === 'main'), label).toBe(true);
                    expect(new Set(ids(p)).size, label).toBe(p.items.length);
                    p.items.forEach((item, index) => {
                      expect(workoutItemSchema.safeParse(item).success, label).toBe(true);
                      expect(item.order).toBe(index);
                    });

                    // Filters
                    for (const id of ids(p)) {
                      const exercise = findExercise(id)!;
                      expect(p.requirements.eligibleExerciseIds, label).toContain(id);
                      expect(exercise.restrictionTags.filter((t) => restrictions.includes(t)), `${label} ${id}`).toEqual([]);
                      expect(hasRequiredEquipment(exercise, equipment), `${label} ${id}`).toBe(true);
                      expect(exercise.applicableLevels, `${label} ${id}`).toContain(fitnessLevel);
                    }
                  }
    expect(count).toBe(3 * 5 * 4 * 5 * 2 * 2 * 3 * 2);
  }, 30_000); // 2,400 generated workouts; can exceed the 5 s default when the suite runs in parallel
});

describe('generateWorkout: behaviour', () => {
  it('is deterministic for a seed, and other seeds give variations', () => {
    expect(plan({}, [], 3)).toEqual(plan({}, [], 3));
    const variants = new Set([0, 1, 2, 3, 4, 5].map((seed) => ids(plan({}, [], seed)).join(',')));
    expect(variants.size).toBeGreaterThan(1);
  });

  it('orders warm-up, main, then cool-down', () => {
    const sections = plan({ availableMinutes: 45 }).items.map((i) => i.section);
    expect(sections.indexOf('main')).toBeGreaterThan(sections.lastIndexOf('warmup'));
    expect(sections.indexOf('cooldown')).toBeGreaterThan(sections.lastIndexOf('main'));
  });

  it('uses most of a 30-minute session for a typical profile', () => {
    const p = plan({ availableMinutes: 30 });
    expect(estimateWorkoutSeconds(p.items, exerciseLibrary)).toBeGreaterThan(30 * 60 * 0.75);
  });

  it('produces different workouts for different profiles', () => {
    const strength = plan({ goals: ['strength'], equipment: ['dumbbells'], fitnessLevel: 'intermediate' });
    const endurance = plan({ goals: ['endurance'], equipment: [], fitnessLevel: 'beginner', availableMinutes: 15 });
    expect(ids(strength)).not.toEqual(ids(endurance));
    const strengthReps = strength.items.find((i) => i.section === 'main' && i.target.type === 'reps')!;
    const enduranceReps = endurance.items.find((i) => i.section === 'main' && i.target.type === 'reps')!;
    expect(strengthReps.target).not.toEqual(enduranceReps.target);
    expect(strength.title).toContain('Strength');
  });

  it('constraints change the selection and are explained', () => {
    const free = plan({ equipment: [] });
    const restricted = plan({ equipment: [] }, ['avoid_deep_knee_flexion', 'avoid_floor_work']);
    expect(ids(free)).toContain('squat');
    expect(ids(restricted)).not.toContain('squat');
    expect(ids(restricted)).not.toContain('push_up');
    const note = restricted.rationale.find((l) => l.includes('restrictions'))!;
    expect(note).toContain('Bodyweight squat');
    expect(note).toContain('not medical advice');
  });

  it('explains equipment and time from the actual profile', () => {
    const p = plan({ equipment: [], availableMinutes: 15 });
    expect(p.rationale).toContain('Bodyweight only: no equipment needed.');
    expect(p.rationale.some((l) => l.includes('within your 15-minute session'))).toBe(true);
  });

  it('fails clearly when nothing is eligible', () => {
    expect(() => generateWorkout({ ...baseRequirements, eligibleExerciseIds: [] }, exerciseLibrary)).toThrow(WorkoutGenerationError);
  });
});

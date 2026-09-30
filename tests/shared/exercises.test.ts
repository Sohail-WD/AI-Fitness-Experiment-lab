import { describe, expect, it } from 'vitest';
import { exerciseLibrary, findExercise } from '../../shared/exercises/library';
import { squatCv, squatExercise } from '../../shared/exercises/squat';
import { calculateAdherence } from '../../shared/metrics/adherence';
import { cvExerciseConfigSchema, exerciseDefinitionSchema } from '../../shared/schemas/exercise';
import { squat as m0Squat } from '../../src/cv/exercises/squat';

describe('exercise library', () => {
  it('every definition passes schema validation', () => {
    for (const exercise of exerciseLibrary) {
      const result = exerciseDefinitionSchema.safeParse(exercise);
      expect(result.success, `${exercise.id}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
    }
  });

  it('has unique ids and can be looked up', () => {
    const ids = exerciseLibrary.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(findExercise('squat')).toBe(squatExercise);
    expect(findExercise('unknown_exercise')).toBeUndefined();
  });

  it('squat CV config used by M0 is the library entry, with unchanged thresholds', () => {
    expect(m0Squat).toBe(squatCv);
    expect(squatExercise.cv).toBe(squatCv);
    expect(squatCv.rep).toEqual({
      topEnterDeg: 70,
      topExitDeg: 60,
      bottomEnterDeg: 15,
      bottomExitDeg: 25,
      reversalDeg: 10,
      minRepDurationMs: 400,
    });
  });

  it('every declared form rule is measurable from the exercise camera view', () => {
    for (const exercise of exerciseLibrary) {
      for (const rule of exercise.cv?.formRules ?? []) {
        expect(rule.measurableFrom).toContain(exercise.cv!.cameraView);
      }
    }
  });
});

describe('exercise definition rules', () => {
  it('rejects a cv config when cvSupport is "none", and vice versa', () => {
    expect(exerciseDefinitionSchema.safeParse({ ...squatExercise, cvSupport: 'none' }).success).toBe(false);
    expect(exerciseDefinitionSchema.safeParse({ ...squatExercise, cv: null }).success).toBe(false);
    expect(exerciseDefinitionSchema.safeParse({ ...squatExercise, cvSupport: 'none', cv: null }).success).toBe(true);
  });

  it('rejects thresholds that are out of order', () => {
    const bad = { ...squatCv, rep: { ...squatCv.rep, bottomEnterDeg: 30 } };
    expect(cvExerciseConfigSchema.safeParse(bad).success).toBe(false);
  });

  it('can describe a future joint-angle exercise (e.g. bicep curl) without new architecture', () => {
    const curlCv = {
      ...squatCv,
      id: 'bicep_curl',
      name: 'Bicep curl (side view)',
      primaryAngle: { kind: 'joint', label: 'Elbow angle', joints: ['shoulder', 'elbow', 'wrist'] },
      overlayJoints: ['shoulder', 'elbow', 'wrist'],
      requiredJoints: ['shoulder', 'elbow', 'wrist'],
      rep: { topEnterDeg: 150, topExitDeg: 140, bottomEnterDeg: 60, bottomExitDeg: 70, reversalDeg: 10, minRepDurationMs: 400 },
      formRules: [],
    };
    expect(cvExerciseConfigSchema.safeParse(curlCv).success).toBe(true);
  });
});

describe('calculateAdherence (spec §14, §23)', () => {
  it('10 planned, 8 completed → 80%', () => {
    expect(calculateAdherence(10, 8)).toBeCloseTo(0.8);
  });

  it('is undefined (null) when nothing was planned', () => {
    expect(calculateAdherence(0, 0)).toBeNull();
  });

  it('rejects impossible inputs', () => {
    expect(() => calculateAdherence(5, 6)).toThrow(RangeError);
    expect(() => calculateAdherence(-1, 0)).toThrow(RangeError);
    expect(() => calculateAdherence(2.5, 1)).toThrow(RangeError);
  });
});

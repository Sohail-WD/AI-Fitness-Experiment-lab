import { describe, expect, it } from 'vitest';
import { exerciseSetResultSchema } from '../shared/schemas/metrics';
import { squat } from '../src/cv/exercises/squat';
import { FrameProcessor } from '../src/cv/frameProcessor';
import { FRAME, syntheticPose } from './syntheticPose';

function ramp(a: number, b: number, steps: number): number[] {
  return Array.from({ length: steps }, (_, i) => a + ((b - a) * i) / (steps - 1));
}

// Knee angles (synthetic shins are vertical, so thigh angle = knee − 90°).
const fullSquat = [...ramp(175, 85, 20), ...ramp(85, 85, 5), ...ramp(85, 175, 20), 175, 175];
const partialSquat = [...ramp(175, 125, 15), ...ramp(125, 175, 15), 175, 175];

function runSet(kneeAngles: number[]) {
  const processor = new FrameProcessor(squat);
  kneeAngles.forEach((a, i) => processor.process(syntheticPose({ kneeAngleDeg: a }), FRAME, i * 33));
  return processor.setResult();
}

describe('CV boundary: FrameProcessor.setResult()', () => {
  it('summarizes a set as a valid ExerciseSetResult', () => {
    const result = runSet([175, ...fullSquat, ...fullSquat, ...partialSquat]);
    expect(exerciseSetResultSchema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({
      exerciseId: 'squat',
      detectedReps: 3,
      validReps: 2,
      invalidReps: 1,
      formIssues: [{ code: 'insufficient_depth', count: 1 }],
      measurementSource: 'cv',
    });
    expect(result.metrics.lowestPrimaryAngleDeg).toBeLessThanOrEqual(0);
    expect(result.metrics.averageRepDurationMs).toBeGreaterThan(squat.rep.minRepDurationMs);
    expect(result.metrics.usableFrameRatio).toBe(1);
  });

  it('reports an empty set without inventing numbers', () => {
    const result = runSet([]);
    expect(result).toMatchObject({ detectedReps: 0, validReps: 0, invalidReps: 0, formIssues: [] });
    expect(result.metrics).toEqual({ lowestPrimaryAngleDeg: null, averageRepDurationMs: null, usableFrameRatio: null });
  });

  it('only uses issue codes declared by the exercise form rules', () => {
    const declared = squat.formRules.map((r) => r.code);
    const result = runSet([175, ...partialSquat]);
    for (const issue of result.formIssues) expect(declared).toContain(issue.code);
  });

  it('starts fresh after reset', () => {
    const processor = new FrameProcessor(squat);
    [175, ...fullSquat].forEach((a, i) => processor.process(syntheticPose({ kneeAngleDeg: a }), FRAME, i * 33));
    expect(processor.setResult().validReps).toBe(1);
    processor.reset();
    expect(processor.setResult().detectedReps).toBe(0);
  });
});

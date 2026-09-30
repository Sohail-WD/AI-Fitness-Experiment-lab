import { describe, expect, it } from 'vitest';
import { squat } from '../src/cv/exercises/squat';
import { FrameProcessor } from '../src/cv/frameProcessor';
import { LandmarkSmoother } from '../src/cv/smoothing';
import type { Landmark } from '../src/cv/types';
import { FRAME, syntheticPose } from './syntheticPose';

function ramp(a: number, b: number, steps: number): number[] {
  return Array.from({ length: steps }, (_, i) => a + ((b - a) * i) / (steps - 1));
}

function runPipeline(frames: (Landmark[] | null)[]) {
  const processor = new FrameProcessor(squat);
  return frames.map((lm, i) => processor.process(lm, FRAME, i * 33)).at(-1)!;
}

const squatAngles = [...ramp(175, 175, 5), ...ramp(175, 85, 20), ...ramp(85, 85, 5), ...ramp(85, 175, 20), 175, 175, 175];

describe('FrameProcessor (landmarks → smoothing → angles → reps)', () => {
  it('counts one rep from a synthetic side-view squat', () => {
    const result = runPipeline(squatAngles.map((a) => syntheticPose({ kneeAngleDeg: a })));
    expect(result.reps.validReps).toBe(1);
    expect(result.reps.phase).toBe('STANDING');
  });

  it('counts nothing when the user faces the camera', () => {
    const result = runPipeline(squatAngles.map((a) => syntheticPose({ kneeAngleDeg: a, lateralSpreadPx: 180 })));
    expect(result.analysis.setup.status).toBe('wrong_view');
    expect(result.reps.validReps).toBe(0);
    expect(result.reps.phase).toBe('UNKNOWN');
  });

  it('does not count a squat while the lower body is poorly visible', () => {
    const lowVis = { 25: 0.2, 26: 0.2, 27: 0.2, 28: 0.2 };
    const result = runPipeline(squatAngles.map((a) => syntheticPose({ kneeAngleDeg: a, visibilityOverrides: lowVis })));
    expect(result.analysis.setup.status).toBe('low_visibility');
    expect(result.reps.validReps).toBe(0);
  });

  it('logs each rep and partial with its lowest knee angle', () => {
    const partial = [...ramp(175, 125, 15), ...ramp(125, 175, 15), 175, 175, 175];
    const result = runPipeline([...squatAngles, ...partial].map((a) => syntheticPose({ kneeAngleDeg: a })));
    expect(result.eventLog.map((e) => e.type)).toEqual(['rep', 'partial']);
    const [rep, part] = result.eventLog as { minAngleDeg: number }[];
    // Thigh angles: full squat reaches ~parallel (≤ 0°); the partial bottoms out at ~35°.
    expect(rep.minAngleDeg).toBeLessThanOrEqual(0);
    expect(part.minAngleDeg).toBeGreaterThan(30);
  });

  it('reports no person and keeps the count when detection drops out', () => {
    const frames: (Landmark[] | null)[] = [...squatAngles.map((a) => syntheticPose({ kneeAngleDeg: a })), null, null];
    const result = runPipeline(frames);
    expect(result.analysis.setup.status).toBe('no_person');
    expect(result.reps.validReps).toBe(1);
  });
});

describe('LandmarkSmoother', () => {
  const lm = (x: number): Landmark[] => [{ x, y: x, z: 0, visibility: 0.9 }];

  it('passes the first frame through and averages later frames', () => {
    const smoother = new LandmarkSmoother(0.5);
    expect(smoother.smooth(lm(0))[0].x).toBe(0);
    expect(smoother.smooth(lm(1))[0].x).toBeCloseTo(0.5);
    expect(smoother.smooth(lm(1))[0].x).toBeCloseTo(0.75);
  });

  it('starts fresh after reset', () => {
    const smoother = new LandmarkSmoother(0.5);
    smoother.smooth(lm(0));
    smoother.reset();
    expect(smoother.smooth(lm(1))[0].x).toBe(1);
  });

  it('rejects invalid alpha', () => {
    expect(() => new LandmarkSmoother(0)).toThrow();
  });
});

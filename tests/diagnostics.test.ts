import { describe, expect, it } from 'vitest';
import { diagnoseCounting } from '../src/cv/diagnostics';
import { squat } from '../src/cv/exercises/squat';
import { FrameProcessor } from '../src/cv/frameProcessor';
import { FRAME, syntheticPose } from './syntheticPose';

function ramp(a: number, b: number, steps: number): number[] {
  return Array.from({ length: steps }, (_, i) => a + ((b - a) * i) / (steps - 1));
}

function diagnose(angles: number[], options: Omit<Parameters<typeof syntheticPose>[0], 'kneeAngleDeg'> = {}) {
  const processor = new FrameProcessor(squat);
  const last = angles.map((a, i) => processor.process(syntheticPose({ kneeAngleDeg: a, ...options }), FRAME, i * 33)).at(-1)!;
  return { text: diagnoseCounting(last.diagnostics, squat), diagnostics: last.diagnostics };
}

const squats = [175, ...ramp(175, 85, 20), ...ramp(85, 175, 20), 175];

describe('diagnoseCounting', () => {
  it('names the main setup blocker', () => {
    const { text, diagnostics } = diagnose(squats, { lateralSpreadPx: 180 });
    expect(diagnostics.framesByStatus.wrong_view).toBe(squats.length);
    expect(text).toContain('not side-on');
  });

  it('reports insufficient depth with the lowest angle seen', () => {
    const { text } = diagnose([175, ...ramp(175, 120, 20), ...ramp(120, 175, 20), 175]);
    // Knee 120° = thigh 30°; smoothing lags the turnaround slightly, so ~30–35°.
    expect(text).toMatch(/Depth not reached.*lowest thigh angle 3[0-5]°/);
  });

  it('reports when standing is never recognised', () => {
    // Knee 150° = thigh 60°, below the 70° standing threshold.
    const { text } = diagnose([150, ...ramp(150, 85, 20), ...ramp(85, 150, 20), 150]);
    expect(text).toMatch(/Standing position not recognised.*highest thigh angle 60°/);
  });

  it('records the raw angle range even when setup fails', () => {
    const { diagnostics } = diagnose(squats, { lateralSpreadPx: 180 });
    expect(diagnostics.countedAngleMinDeg).toBeNull();
    expect(diagnostics.rawAngleMinDeg).toBeLessThan(squat.rep.bottomEnterDeg);
  });

  it('confirms thresholds are reached for a good squat', () => {
    const { text } = diagnose(squats);
    expect(text).toContain('both being reached');
  });
});

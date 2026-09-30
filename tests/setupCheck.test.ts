import { describe, expect, it } from 'vitest';
import { analyzeFrame } from '../src/cv/analyzeFrame';
import { squat } from '../src/cv/exercises/squat';
import { checkSetup, chooseTrackedSide } from '../src/cv/setupCheck';
import { landmarkIndex } from '../src/cv/types';
import { FRAME, syntheticPose } from './syntheticPose';

describe('checkSetup', () => {
  it('reports no person when there are no landmarks', () => {
    expect(checkSetup(null, 'left', FRAME, squat).status).toBe('no_person');
  });

  it('accepts a clear side-view pose', () => {
    const result = checkSetup(syntheticPose({ kneeAngleDeg: 170 }), 'left', FRAME, squat);
    expect(result.status).toBe('ok');
    expect(result.confidence).toBeCloseTo(0.95);
  });

  it('flags low visibility of a required landmark', () => {
    const pose = syntheticPose({ kneeAngleDeg: 170, visibilityOverrides: { [landmarkIndex('left', 'ankle')]: 0.3 } });
    expect(checkSetup(pose, 'left', FRAME, squat).status).toBe('low_visibility');
  });

  it('flags a required landmark at the frame edge', () => {
    const pose = syntheticPose({ kneeAngleDeg: 170, ankleY: 718 });
    expect(checkSetup(pose, 'left', FRAME, squat).status).toBe('out_of_frame');
  });

  it('flags a front-facing pose for a side-view exercise', () => {
    const pose = syntheticPose({ kneeAngleDeg: 170, lateralSpreadPx: 180 });
    expect(checkSetup(pose, 'left', FRAME, squat).status).toBe('wrong_view');
  });
});

describe('chooseTrackedSide', () => {
  it('picks the side with higher landmark visibility', () => {
    const pose = syntheticPose({
      kneeAngleDeg: 170,
      visibilityOverrides: {
        [landmarkIndex('left', 'hip')]: 0.4,
        [landmarkIndex('left', 'knee')]: 0.4,
        [landmarkIndex('left', 'ankle')]: 0.4,
      },
    });
    expect(chooseTrackedSide(pose, squat)).toBe('right');
  });
});

describe('analyzeFrame', () => {
  it('measures thigh angle (primary) and knee angle (info) from landmarks', () => {
    // Synthetic shins are vertical, so thigh angle above horizontal = knee angle − 90°.
    for (const knee of [175, 140, 100, 80]) {
      const analysis = analyzeFrame(syntheticPose({ kneeAngleDeg: knee }), FRAME, squat);
      expect(analysis.primaryAngleDeg).toBeCloseTo(knee - 90, 5);
      expect(analysis.kneeAngleDeg).toBeCloseTo(knee, 5);
    }
  });

  it('withholds angles when the setup is not reliable', () => {
    const analysis = analyzeFrame(syntheticPose({ kneeAngleDeg: 90, lateralSpreadPx: 180 }), FRAME, squat);
    expect(analysis.setup.status).toBe('wrong_view');
    expect(analysis.primaryAngleDeg).toBeNull();
  });
});

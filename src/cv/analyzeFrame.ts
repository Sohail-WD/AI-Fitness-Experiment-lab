import type { AngleMeasurement, CvExerciseConfig } from './exercises/types';
import { jointAngle, segmentElevation, toPixels } from './geometry';
import { checkSetup, chooseTrackedSide, type SetupResult } from './setupCheck';
import { type BodySide, type FrameSize, type Joint, type Landmark, landmarkIndex, type Point2D } from './types';

export interface FrameAnalysis {
  setup: SetupResult;
  side: BodySide | null;
  /** Primary angle in degrees; null when the pose is not reliable enough. */
  primaryAngleDeg: number | null;
  /**
   * Primary angle computed even when setup checks fail. Diagnostics only —
   * never feed this to the rep counter.
   */
  rawPrimaryAngleDeg: number | null;
  /** Knee (hip–knee–ankle) and hip (shoulder–hip–knee) angles, informational only in M0. */
  kneeAngleDeg: number | null;
  hipAngleDeg: number | null;
  /** Current value of each checked form rule's measurement, keyed by rule code (reliable frames only). */
  ruleValues: Record<string, number | null>;
  /** Bilateral exercises only: primary angle of each side (reliable frames only). */
  bilateralAnglesDeg: { left: number | null; right: number | null } | null;
}

export function measureAngle(measurement: AngleMeasurement, px: (joint: Joint) => Point2D): number | null {
  if (measurement.kind === 'joint') {
    const [a, b, c] = measurement.joints;
    return jointAngle(px(a), px(b), px(c));
  }
  return segmentElevation(px(measurement.from), px(measurement.to));
}

/** Turn one frame of (smoothed) landmarks into setup status and angles. */
export function analyzeFrame(
  landmarks: Landmark[] | null,
  frame: FrameSize,
  exercise: CvExerciseConfig,
): FrameAnalysis {
  if (!landmarks) {
    return {
      setup: checkSetup(null, 'left', frame, exercise),
      side: null,
      primaryAngleDeg: null,
      rawPrimaryAngleDeg: null,
      kneeAngleDeg: null,
      hipAngleDeg: null,
      ruleValues: {},
      bilateralAnglesDeg: null,
    };
  }

  const side = chooseTrackedSide(landmarks, exercise);
  let setup = checkSetup(landmarks, side, frame, exercise);
  // Bilateral exercises need both sides to pass the setup checks.
  if (exercise.bilateral && setup.status === 'ok') {
    const other = checkSetup(landmarks, side === 'left' ? 'right' : 'left', frame, exercise);
    if (other.status !== 'ok') setup = other;
  }
  const pxFor = (s: BodySide) => (joint: Joint) => toPixels(landmarks[landmarkIndex(s, joint)], frame);
  const px = pxFor(side);
  const rawPrimaryAngleDeg = measureAngle(exercise.primaryAngle, px);

  if (setup.status !== 'ok') {
    return {
      setup,
      side,
      primaryAngleDeg: null,
      rawPrimaryAngleDeg,
      kneeAngleDeg: null,
      hipAngleDeg: null,
      ruleValues: {},
      bilateralAnglesDeg: null,
    };
  }
  const ruleValues: Record<string, number | null> = {};
  for (const rule of exercise.formRules) {
    if (rule.check) ruleValues[rule.code] = measureAngle(rule.check.measurement, px);
  }
  return {
    setup,
    side,
    primaryAngleDeg: rawPrimaryAngleDeg,
    rawPrimaryAngleDeg,
    kneeAngleDeg: jointAngle(px('hip'), px('knee'), px('ankle')),
    hipAngleDeg: jointAngle(px('shoulder'), px('hip'), px('knee')),
    ruleValues,
    bilateralAnglesDeg: exercise.bilateral
      ? { left: measureAngle(exercise.primaryAngle, pxFor('left')), right: measureAngle(exercise.primaryAngle, pxFor('right')) }
      : null,
  };
}

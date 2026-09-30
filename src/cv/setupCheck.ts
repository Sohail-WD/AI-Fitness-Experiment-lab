import type { CvExerciseConfig } from './exercises/types';
import { distance, toPixels } from './geometry';
import { type BodySide, type FrameSize, type Joint, type Landmark, landmarkIndex, POSE_LANDMARK_COUNT } from './types';

export type SetupStatus = 'ok' | 'no_person' | 'low_visibility' | 'out_of_frame' | 'wrong_view';

export interface SetupResult {
  status: SetupStatus;
  /** Short, user-facing guidance. */
  message: string;
  /** Mean visibility of the required landmarks on the tracked side (0–1), or 0 if no person. */
  confidence: number;
  /** Raw values behind the decision, for diagnostics and threshold calibration. */
  measurements?: SetupMeasurements;
}

export interface SetupMeasurements {
  weakestJoint: Joint;
  weakestVisibility: number;
  /** Shoulder/hip spread ratio (small = side-on, large = facing the camera); null for a degenerate torso. */
  spreadRatio: number | null;
}

const MESSAGES: Record<SetupStatus, string> = {
  ok: 'Tracking',
  no_person: 'No person detected. Step into the frame.',
  low_visibility: "I can't clearly see your full body. Step back and check the lighting.",
  out_of_frame: 'Part of your body is out of frame. Move farther from the camera.',
  wrong_view: 'Turn sideways to the camera for this exercise.',
};
const FACE_CAMERA_MESSAGE = 'Face the camera for this exercise.';

function result(status: SetupStatus, confidence: number): SetupResult {
  return { status, message: MESSAGES[status], confidence };
}

/** Pick the body side facing the camera: highest mean visibility of the required joints. */
export function chooseTrackedSide(landmarks: Landmark[], exercise: CvExerciseConfig): BodySide {
  const score = (side: BodySide) =>
    exercise.requiredJoints.reduce((sum, j) => sum + (landmarks[landmarkIndex(side, j)].visibility ?? 0), 0);
  return score('left') >= score('right') ? 'left' : 'right';
}

/**
 * Horizontal spread of the left/right shoulders and hips relative to torso
 * length. Near 0 when side-on (the pairs overlap), ~0.6+ when facing the camera.
 */
export function sideViewSpreadRatio(landmarks: Landmark[], side: BodySide, frame: FrameSize): number | null {
  const px = (i: number) => toPixels(landmarks[i], frame);
  const shoulderSpread = Math.abs(px(landmarkIndex('left', 'shoulder')).x - px(landmarkIndex('right', 'shoulder')).x);
  const hipSpread = Math.abs(px(landmarkIndex('left', 'hip')).x - px(landmarkIndex('right', 'hip')).x);
  const torso = distance(px(landmarkIndex(side, 'shoulder')), px(landmarkIndex(side, 'hip')));
  if (torso === 0) return null;
  return Math.max(shoulderSpread, hipSpread) / torso;
}

/** Deterministic per-frame check of whether the pose is reliable enough to measure. */
export function checkSetup(
  landmarks: Landmark[] | null,
  side: BodySide,
  frame: FrameSize,
  exercise: CvExerciseConfig,
): SetupResult {
  if (!landmarks || landmarks.length < POSE_LANDMARK_COUNT) return result('no_person', 0);

  const { minVisibility, edgeMargin, maxSideViewSpreadRatio } = exercise.setup;
  const required = exercise.requiredJoints.map((joint) => ({ joint, lm: landmarks[landmarkIndex(side, joint)] }));
  const confidence = required.reduce((sum, r) => sum + (r.lm.visibility ?? 0), 0) / required.length;

  const weakest = required.reduce((min, r) => ((r.lm.visibility ?? 0) < (min.lm.visibility ?? 0) ? r : min));
  const measurements: SetupMeasurements = {
    weakestJoint: weakest.joint,
    weakestVisibility: weakest.lm.visibility ?? 0,
    spreadRatio: sideViewSpreadRatio(landmarks, side, frame),
  };
  const withMeasurements = (status: SetupStatus) => ({
    ...result(status, confidence),
    ...(status === 'wrong_view' && exercise.cameraView === 'front' ? { message: FACE_CAMERA_MESSAGE } : {}),
    measurements,
  });

  const outOfFrame = required.some(
    ({ lm }) => lm.x < edgeMargin || lm.x > 1 - edgeMargin || lm.y < edgeMargin || lm.y > 1 - edgeMargin,
  );
  if (outOfFrame) return withMeasurements('out_of_frame');

  if (measurements.weakestVisibility < minVisibility) return withMeasurements('low_visibility');

  const ratio = measurements.spreadRatio;
  if (exercise.cameraView === 'side') {
    if (ratio === null || ratio > maxSideViewSpreadRatio) return withMeasurements('wrong_view');
  } else if (exercise.setup.minFrontViewSpreadRatio !== undefined) {
    if (ratio === null || ratio < exercise.setup.minFrontViewSpreadRatio) return withMeasurements('wrong_view');
  }

  return withMeasurements('ok');
}

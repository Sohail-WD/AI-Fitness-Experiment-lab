import type { Joint } from '../../shared/schemas/exercise';

/** A single pose landmark in MediaPipe's normalized image space (x, y in [0, 1]). */
export interface Landmark {
  x: number;
  y: number;
  z: number;
  /** Likelihood (0–1) that the landmark is visible and not occluded. */
  visibility?: number;
}

export interface FrameSize {
  width: number;
  height: number;
}

export interface Point2D {
  x: number;
  y: number;
}

/** Subset of MediaPipe BlazePose landmark indices used by the prototype. */
export const PoseLandmarkIndex = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
} as const;

export type BodySide = 'left' | 'right';

export type { Joint } from '../../shared/schemas/exercise';

const SIDE_INDEX: Record<BodySide, Record<Joint, number>> = {
  left: {
    shoulder: PoseLandmarkIndex.LEFT_SHOULDER,
    elbow: PoseLandmarkIndex.LEFT_ELBOW,
    wrist: PoseLandmarkIndex.LEFT_WRIST,
    hip: PoseLandmarkIndex.LEFT_HIP,
    knee: PoseLandmarkIndex.LEFT_KNEE,
    ankle: PoseLandmarkIndex.LEFT_ANKLE,
  },
  right: {
    shoulder: PoseLandmarkIndex.RIGHT_SHOULDER,
    elbow: PoseLandmarkIndex.RIGHT_ELBOW,
    wrist: PoseLandmarkIndex.RIGHT_WRIST,
    hip: PoseLandmarkIndex.RIGHT_HIP,
    knee: PoseLandmarkIndex.RIGHT_KNEE,
    ankle: PoseLandmarkIndex.RIGHT_ANKLE,
  },
};

export function landmarkIndex(side: BodySide, joint: Joint): number {
  return SIDE_INDEX[side][joint];
}

/** Number of landmarks produced by MediaPipe Pose Landmarker. */
export const POSE_LANDMARK_COUNT = 33;

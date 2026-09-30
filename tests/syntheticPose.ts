import { type FrameSize, type Landmark, landmarkIndex, POSE_LANDMARK_COUNT } from '../src/cv/types';

export const FRAME: FrameSize = { width: 1280, height: 720 };

interface PoseOptions {
  kneeAngleDeg: number;
  /** Horizontal pixel offset between left and right shoulders/hips (≈0 side-on, large when facing camera). */
  lateralSpreadPx?: number;
  visibility?: number;
  /** Overrides visibility for the given landmark indices. */
  visibilityOverrides?: Record<number, number>;
  /** Pixel y of the ankles (move near 720 to push feet out of frame). */
  ankleY?: number;
}

/**
 * Build a synthetic side-view pose (33 landmarks, normalized) whose knee
 * angle on both sides is exactly kneeAngleDeg. Shin is vertical; the thigh
 * rotates backward from the knee; the torso is upright above the hip.
 */
export function syntheticPose({
  kneeAngleDeg,
  lateralSpreadPx = 10,
  visibility = 0.95,
  visibilityOverrides = {},
  ankleY = 650,
}: PoseOptions): Landmark[] {
  const shin = 170;
  const thigh = 170;
  const torso = 220;
  const theta = (kneeAngleDeg * Math.PI) / 180;

  const ankle = { x: 700, y: ankleY };
  const knee = { x: ankle.x, y: ankle.y - shin };
  const hip = { x: knee.x - thigh * Math.sin(theta), y: knee.y + thigh * Math.cos(theta) };
  const shoulder = { x: hip.x, y: hip.y - torso };

  const norm = (p: { x: number; y: number }, dx = 0): Landmark => ({
    x: (p.x + dx) / FRAME.width,
    y: p.y / FRAME.height,
    z: 0,
    visibility,
  });

  const landmarks: Landmark[] = Array.from({ length: POSE_LANDMARK_COUNT }, () => norm(hip));
  // Each side is shifted as a whole so per-side joint angles are unaffected by the spread.
  const place = (joint: 'shoulder' | 'hip' | 'knee' | 'ankle', p: { x: number; y: number }) => {
    landmarks[landmarkIndex('left', joint)] = norm(p, -lateralSpreadPx / 2);
    landmarks[landmarkIndex('right', joint)] = norm(p, lateralSpreadPx / 2);
  };
  place('shoulder', shoulder);
  place('hip', hip);
  place('knee', knee);
  place('ankle', ankle);

  for (const [index, v] of Object.entries(visibilityOverrides)) {
    landmarks[Number(index)] = { ...landmarks[Number(index)], visibility: v };
  }
  return landmarks;
}

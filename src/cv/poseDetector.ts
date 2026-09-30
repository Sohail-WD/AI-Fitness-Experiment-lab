import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { Landmark } from './types';

/**
 * WASM runtime is self-hosted (copied from node_modules into public/ by
 * scripts/copy-mediapipe-wasm.mjs). The model file is loaded from Google's
 * official model storage; inference always runs locally in the browser.
 */
const WASM_BASE_PATH = new URL(`${import.meta.env.BASE_URL}mediapipe/wasm`, window.location.href).href;
export const POSE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

export const POSE_CONNECTIONS = PoseLandmarker.POSE_CONNECTIONS;

export interface PoseDetector {
  /** Landmarks of the single detected person, or null if nobody is detected. */
  detect(video: HTMLVideoElement, timestampMs: number): Landmark[] | null;
  close(): void;
  delegate: 'GPU' | 'CPU';
}

export async function createPoseDetector(): Promise<PoseDetector> {
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE_PATH);

  const create = (delegate: 'GPU' | 'CPU') =>
    PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

  let delegate: 'GPU' | 'CPU' = 'GPU';
  let landmarker: PoseLandmarker;
  try {
    landmarker = await create('GPU');
  } catch {
    delegate = 'CPU';
    landmarker = await create('CPU');
  }

  return {
    delegate,
    detect(video, timestampMs) {
      const result = landmarker.detectForVideo(video, timestampMs);
      return result.landmarks[0] ?? null;
    },
    close() {
      landmarker.close();
    },
  };
}

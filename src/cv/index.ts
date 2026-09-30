/**
 * Public interface of the computer-vision module. Code outside src/cv should
 * import from here and consume ExerciseSetResult, not the state machine.
 */
export { CameraError } from './camera';
export { FrameProcessor, type ProcessedFrame } from './frameProcessor';
export type { CvExerciseConfig } from './exercises/types';
export type { ExerciseSetResult } from '../../shared/schemas/metrics';

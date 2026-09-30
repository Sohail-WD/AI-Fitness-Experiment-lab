import type { CvExerciseConfig } from '../schemas/exercise.ts';

/**
 * CV configurations for exercises beyond the squat (M4). All run on the same
 * generic pipeline: one primary angle drives the rep state machine; form rules
 * with a `check` are evaluated per rep. Thresholds are engineering estimates
 * to be calibrated with real recordings.
 */

const SIDE_SETUP = { minVisibility: 0.6, edgeMargin: 0.02, maxSideViewSpreadRatio: 0.4, trackingLossResetMs: 1000 };
const SPEED_RULE = {
  code: 'excessive_speed',
  description: 'Full rep completed faster than the minimum rep duration.',
  measurableFrom: ['side', 'front'] as CvExerciseConfig['cameraView'][],
  feedback: 'Slow down the movement.',
};

/** Reverse lunge, side view. Both knees bend in a lunge, so the tracked-side knee works for either leg. */
export const lungeCv: CvExerciseConfig = {
  id: 'reverse_lunge',
  name: 'Lunge (side view)',
  cameraView: 'side',
  primaryAngle: { kind: 'joint', label: 'Knee angle', joints: ['hip', 'knee', 'ankle'] },
  overlayJoints: ['hip', 'knee', 'ankle'],
  requiredJoints: ['shoulder', 'hip', 'knee', 'ankle'],
  rep: {
    // Standing legs read ~165–180°.
    topEnterDeg: 160,
    topExitDeg: 150,
    // A full lunge bends the knees to ~90°; 110° allows for 2D projection and noise.
    bottomEnterDeg: 110,
    bottomExitDeg: 120,
    reversalDeg: 10,
    // Stepping back and returning takes longer than a squat.
    minRepDurationMs: 600,
  },
  setup: { ...SIDE_SETUP, trackingLossResetMs: 1500 },
  issueCodes: { partial: 'insufficient_depth', tooFast: 'excessive_speed' },
  formRules: [
    {
      code: 'insufficient_depth',
      description: 'Knee did not bend to the depth threshold before standing up.',
      measurableFrom: ['side'],
      feedback: 'Lower until both knees are bent to about 90°.',
    },
    SPEED_RULE,
    {
      code: 'torso_lean',
      description: 'Torso leaned more than 30° from vertical during the rep.',
      measurableFrom: ['side'],
      feedback: 'Keep your torso upright.',
      // Shoulder→hip elevation: 90° = upright; below 60° = leaning more than 30°.
      check: {
        measurement: { kind: 'segmentFromHorizontal', label: 'Torso angle', from: 'shoulder', to: 'hip' },
        bound: 'min',
        limitDeg: 60,
        invalidatesRep: false,
      },
    },
  ],
  phaseLabels: { top: 'Standing', toTarget: 'Lowering', target: 'Bottom', toTop: 'Rising' },
  setupInstructions: 'Stand side-on, 2–3 m from the camera, with your whole body visible. Alternate legs.',
};

/** Bicep curl, side view: elbow flexion is clearest in profile. */
export const curlCv: CvExerciseConfig = {
  id: 'dumbbell_bicep_curl',
  name: 'Bicep curl (side view)',
  cameraView: 'side',
  primaryAngle: { kind: 'joint', label: 'Elbow angle', joints: ['shoulder', 'elbow', 'wrist'] },
  overlayJoints: ['shoulder', 'elbow', 'wrist'],
  requiredJoints: ['shoulder', 'elbow', 'wrist', 'hip'],
  rep: {
    // Arm hanging ~160–180°; 150° tolerates a soft elbow.
    topEnterDeg: 150,
    topExitDeg: 140,
    // Fully curled ~40–60°.
    bottomEnterDeg: 60,
    bottomExitDeg: 70,
    reversalDeg: 10,
    minRepDurationMs: 500,
  },
  setup: SIDE_SETUP,
  issueCodes: { partial: 'incomplete_curl', tooFast: 'excessive_speed' },
  formRules: [
    {
      code: 'incomplete_curl',
      description: 'Elbow did not bend to the target before lowering.',
      measurableFrom: ['side'],
      feedback: 'Curl all the way up.',
    },
    SPEED_RULE,
    {
      code: 'elbow_drift',
      description: 'Upper arm swung more than 30° forward from vertical (momentum instead of the biceps).',
      measurableFrom: ['side'],
      feedback: 'Keep your elbow at your side.',
      // Shoulder→elbow elevation: 90° = upper arm hanging vertically.
      check: {
        measurement: { kind: 'segmentFromHorizontal', label: 'Upper-arm angle', from: 'shoulder', to: 'elbow' },
        bound: 'min',
        limitDeg: 60,
        invalidatesRep: true,
      },
    },
  ],
  phaseLabels: { top: 'Arm extended', toTarget: 'Curling', target: 'Top of curl', toTop: 'Lowering' },
  setupInstructions: 'Stand side-on, 2–3 m from the camera, with the working arm facing it and your hips visible.',
};

/**
 * Shoulder press, front view. The elbow angle INCREASES from rack to lockout.
 * Both arms are tracked: a rep needs both at the rack, both at lockout, and both back.
 */
export const pressCv: CvExerciseConfig = {
  id: 'dumbbell_shoulder_press',
  name: 'Shoulder press (front view)',
  cameraView: 'front',
  primaryAngle: { kind: 'joint', label: 'Elbow angle', joints: ['shoulder', 'elbow', 'wrist'] },
  repDirection: 'increasing',
  bilateral: true,
  overlayJoints: ['shoulder', 'elbow', 'wrist'],
  requiredJoints: ['shoulder', 'elbow', 'wrist', 'hip'],
  rep: {
    // Rack position (weights at shoulders): elbow ~70–95°.
    topEnterDeg: 100,
    topExitDeg: 110,
    // Lockout: elbow nearly straight.
    bottomEnterDeg: 155,
    bottomExitDeg: 145,
    reversalDeg: 10,
    minRepDurationMs: 500,
  },
  setup: { ...SIDE_SETUP, minFrontViewSpreadRatio: 0.45 },
  issueCodes: { partial: 'incomplete_lockout', tooFast: 'excessive_speed' },
  formRules: [
    {
      code: 'incomplete_lockout',
      description: 'Arm did not straighten to the lockout threshold before lowering.',
      measurableFrom: ['front'],
      feedback: 'Press all the way up.',
    },
    SPEED_RULE,
  ],
  phaseLabels: { top: 'Rack position', toTarget: 'Pressing', target: 'Lockout', toTop: 'Lowering' },
  setupInstructions:
    'Face the camera, 2–3 m away. Frame yourself from above your raised hands down to your hips. Start with the weights at your shoulders.',
};

/**
 * Push-up, side view. EXPERIMENTAL: pose models are less reliable on a
 * horizontal body and this has not been validated with real recordings, so
 * the workout runner keeps manual rep entry for push-ups. Available in the
 * CV Lab for testing only.
 */
export const pushUpCvExperimental: CvExerciseConfig = {
  id: 'push_up',
  name: 'Push-up (side view, experimental)',
  cameraView: 'side',
  primaryAngle: { kind: 'joint', label: 'Elbow angle', joints: ['shoulder', 'elbow', 'wrist'] },
  overlayJoints: ['shoulder', 'elbow', 'wrist'],
  requiredJoints: ['shoulder', 'elbow', 'wrist', 'hip', 'ankle'],
  rep: { topEnterDeg: 150, topExitDeg: 140, bottomEnterDeg: 100, bottomExitDeg: 110, reversalDeg: 10, minRepDurationMs: 500 },
  setup: SIDE_SETUP,
  issueCodes: { partial: 'insufficient_depth', tooFast: 'excessive_speed' },
  formRules: [
    {
      code: 'insufficient_depth',
      description: 'Elbows did not bend to the depth threshold before pushing up.',
      measurableFrom: ['side'],
      feedback: 'Lower your chest further.',
    },
    SPEED_RULE,
    {
      code: 'body_line',
      description: 'Shoulder–hip–ankle line bent more than 30° (sagging or piking).',
      measurableFrom: ['side'],
      feedback: 'Keep your body in a straight line.',
      check: {
        measurement: { kind: 'joint', label: 'Body line', joints: ['shoulder', 'hip', 'ankle'] },
        bound: 'min',
        limitDeg: 150,
        invalidatesRep: false,
      },
    },
  ],
  phaseLabels: { top: 'Arms extended', toTarget: 'Lowering', target: 'Bottom', toTop: 'Pushing up' },
  setupInstructions: 'Place the camera at floor level, side-on, 2–3 m away, with your whole body visible.',
};

/** Same configuration under another library exercise id (e.g. band vs dumbbell variant). */
export function forExercise(config: CvExerciseConfig, id: string): CvExerciseConfig {
  return { ...config, id };
}

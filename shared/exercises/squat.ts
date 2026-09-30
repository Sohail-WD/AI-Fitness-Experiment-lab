import type { CvExerciseConfig, ExerciseDefinition } from '../schemas/exercise.ts';

/**
 * Side-view bodyweight squat. Depth is judged by thigh angle (hip→knee vs
 * horizontal), the usual definition of squat depth, rather than knee angle,
 * which also depends on how far the shins lean. Thresholds are engineering
 * estimates to be calibrated with real recordings (see README).
 */
export const squatCv: CvExerciseConfig = {
  id: 'squat',
  name: 'Squat (side view)',
  cameraView: 'side',
  primaryAngle: { kind: 'segmentFromHorizontal', label: 'Thigh angle', from: 'hip', to: 'knee' },
  overlayJoints: ['hip', 'knee', 'ankle'],
  requiredJoints: ['shoulder', 'hip', 'knee', 'ankle'],
  rep: {
    // Standing thigh is near vertical (~80–90°); 70° tolerates lean and camera perspective.
    topEnterDeg: 70,
    // 10° hysteresis band so jitter near the top does not start a descent.
    topExitDeg: 60,
    // Within 15° of parallel. A ~40%-depth squat reads ~37°, so it is not counted.
    bottomEnterDeg: 15,
    // 10° hysteresis band at the bottom.
    bottomExitDeg: 25,
    // Rising 10° above the lowest angle before depth = turned back early.
    reversalDeg: 10,
    // A controlled squat takes well over 0.4 s; faster "reps" are glitches.
    minRepDurationMs: 400,
  },
  setup: {
    // Stricter than MediaPipe's common 0.5 default to avoid guessed landmarks.
    minVisibility: 0.6,
    edgeMargin: 0.02,
    // Side-on shoulders/hips overlap (ratio ~0–0.25); facing the camera ~0.6+.
    maxSideViewSpreadRatio: 0.4,
    trackingLossResetMs: 1000,
  },
  issueCodes: { partial: 'insufficient_depth', tooFast: 'excessive_speed' },
  // Both rules are enforced by the rep state machine (partial rep / too-fast rep).
  formRules: [
    {
      code: 'insufficient_depth',
      description: 'Thigh did not come within the depth threshold of parallel before standing up.',
      measurableFrom: ['side'],
      feedback: 'Go slightly deeper.',
    },
    {
      code: 'excessive_speed',
      description: 'Full rep completed faster than the minimum rep duration.',
      measurableFrom: ['side'],
      feedback: 'Slow down the movement.',
    },
  ],
  setupInstructions:
    'Place the camera at hip height, 2–3 m away. Stand side-on so your whole body, head to feet, is visible.',
};

export const squatExercise: ExerciseDefinition = {
  id: 'squat',
  name: 'Bodyweight squat',
  movementPattern: 'squat',
  targetMuscles: ['quadriceps', 'glutes', 'hamstrings'],
  difficulty: 'beginner',
  requiredEquipment: [],
  roles: ['main'],
  targetType: 'reps',
  secondsPerRep: 3,
  perSide: false,
  minSpace: 'small',
  instructions: [
    'Stand with feet about shoulder-width apart.',
    'Push your hips back and bend your knees, keeping your chest up.',
    'Lower until your thighs are about parallel to the floor.',
    'Push through your feet to return to standing.',
  ],
  demoUrl: null,
  applicableGoals: ['general_fitness', 'strength', 'muscle_building', 'endurance', 'weight_management', 'consistency'],
  applicableLevels: ['beginner', 'intermediate', 'advanced'],
  // Squatting to parallel is deep knee flexion.
  restrictionTags: ['avoid_deep_knee_flexion'],
  cvSupport: 'rep_counting_and_form',
  cv: squatCv,
};
